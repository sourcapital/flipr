import _ from 'underscore'
import {config} from '../config.js'
import {Chain, Polkadot} from './Polkadot.js'
import {safeAxiosPost} from '../helpers/Axios.js'
import {HeartbeatType, IncidentType} from '../integrations/BetterStack.js'
import {
    getActiveAuthorityInfo,
    getLatestAuction,
    getActiveCacheValidators,
    paginatedPenaltiesQuery,
    getValidatorLatestBlockInfo,
    getExtrinsicsByValidator
} from '../helpers/GraphQL.js'
import {
    chainflipVersionGauge,
    nodeBondGauge,
    nodeRewardGauge,
    networkMinActiveBondGauge,
    nodeReputationGauge,
    networkReputationBestGauge,
    networkReputationMedianGauge,
    networkReputationAverageGauge,
    networkReputationWorstTop10ThresholdGauge,
    networkReputationWorstGauge,
    nodePenaltyGauge,
    nodeObservedBlockHeightGauge
} from '../integrations/Prometheus.js'

export class Chainflip extends Polkadot {
    private GRAPHQL_PROCESSOR_ENDPOINT = 'https://processor-perseverance.chainflip.io/graphql'
    private GRAPHQL_CACHE_ENDPOINT = 'https://chainflip-cache-perseverance.chainflip.io/graphql'

    constructor(url: string) {
        super(url, Chain.Substrate)
    }

    async initHeartbeats() {
        await global.betterStack?.initHeartbeats(Chainflip.name, [
            HeartbeatType.HEALTH,
            HeartbeatType.VERSION
        ])
        await super.initHeartbeats()
    }

    async isUp(): Promise<boolean> {
        await log.debug(`${Chainflip.name}: Checking if the node is up ...`)

        const nodeResponse = await super.query('cf_account_info_v2', undefined, {
            'account_id': this.getNodeAddress()
        })

        if (nodeResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.isUp.name}: Node HTTP status code: ${nodeResponse?.status}`)
            return false
        }

        if (nodeResponse.data.result.is_online === false) {
            await log.error(`${Chainflip.name}:${this.isUp.name}: Node is not online!`)
            return false
        }

        await log.info(`${Chainflip.name}: Node is up!`)
        await global.betterStack?.sendHeartbeat(Chainflip.name, HeartbeatType.HEALTH)

        return await super.isUp()
    }

    async monitorVersion() {
        await log.debug(`${Chainflip.name}: Checking if node version is up-to-date ...`)

        const nodeResponse = await this.queryGraphQL(this.GRAPHQL_PROCESSOR_ENDPOINT, getActiveAuthorityInfo)

        if (nodeResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorVersion.name}: HTTP status code: ${nodeResponse?.status}`)
            return
        }

        const nodeAddress = this.getNodeAddress()
        const nodes = nodeResponse.data.data.epoch.nodes['0'].memberships.nodes

        const node = _.find(nodes, (node) => {
            return node.validator.idSs58 === nodeAddress
        })

        if (!node) {
            await log.info(`${Chainflip.name}:${this.monitorVersion.name}: Node '${nodeAddress}' not bonded!`)
            return
        }

        // Get the node's version
        const nodeVersion = node.validator.cfeVersion

        // Get the top version of the active nodes
        const topVersion = _.max(_.map(nodes, (node) => {
            return node.validator.cfeVersion
        }), (version) => {
            return Number(version.replace(/\./g, ''))
        })
        await log.debug(`${Chainflip.name}:${this.monitorVersion.name}: topVersion = ${topVersion}`)

        // Parse version as numbers so they can be compared
        const nodeVersionAsNumber = Number(/([0-9]+)\.([0-9]+)\.([0-9]+)/g.exec(nodeVersion)!.slice(1, 4).join(''))
        const topVersionAsNumber = Number(/([0-9]+)\.([0-9]+)\.([0-9]+)/g.exec(topVersion)!.slice(1, 4).join(''))

        if (nodeVersionAsNumber < topVersionAsNumber) {
            await log.warn(`${Chainflip.name}:${this.monitorVersion.name}: nodeVersion < topVersion: '${nodeVersion}' < '${topVersion}'`)
            return
        }

        // Track metric
        chainflipVersionGauge.labels(nodeVersion).set(1)

        await log.info(`${Chainflip.name}: Node version is up-to-date!`)
        await global.betterStack?.sendHeartbeat(Chainflip.name, HeartbeatType.VERSION)
    }

    async monitorBond() {
        await log.debug(`${Chainflip.name}: Monitoring bond ...`)

        const [nodeResponse, latestAuctionResponse] = await Promise.all([
            this.queryGraphQL(this.GRAPHQL_PROCESSOR_ENDPOINT, getActiveAuthorityInfo),
            this.queryGraphQL(this.GRAPHQL_CACHE_ENDPOINT, getLatestAuction)
        ])

        if (nodeResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorBond.name}:getActiveAuthorityInfo: HTTP status code: ${nodeResponse?.status}`)
            return
        }
        if (latestAuctionResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorBond.name}:getLatestAuction: HTTP status code: ${latestAuctionResponse?.status}`)
            return
        }

        const nodeAddress = this.getNodeAddress()
        const nodes = nodeResponse.data.data.epoch.nodes['0'].memberships.nodes

        const node = _.find(_.map(nodes, (node) => {
            return { // Map relevant values
                address: node.validator.idSs58,
                bond: Number(node.bid) / 1e18,
                reward: Number(node.reward) / 1e18
            }
        }), (node) => {
            return node.address === nodeAddress // Find node by address
        })

        if (!node) {
            await log.warn(`${Chainflip.name}:${this.monitorBond.name}: Node '${nodeAddress}' not bonded!`)
            return
        }

        const bond = node.bond
        const reward = node.reward
        const minActiveBond = Number(latestAuctionResponse.data.data.auction.minActiveBid) / 1e18

        // Track metrics
        nodeBondGauge.set(bond)
        nodeRewardGauge.set(reward)
        networkMinActiveBondGauge.set(minActiveBond)

        await log.info(`${Chainflip.name}:Bond: bond = ${bond}; reward = ${reward}; minActiveBond = ${minActiveBond}`)
    }

    async monitorReputation() {
        await log.debug(`${Chainflip.name}: Monitoring reputation ...`)

        const nodeResponse = await this.queryGraphQL(this.GRAPHQL_CACHE_ENDPOINT, getActiveCacheValidators)

        if (nodeResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorReputation.name}: Node HTTP status code: ${nodeResponse?.status}`)
            return
        }

        const nodes = _.sortBy(_.map(_.filter(nodeResponse.data.data.validators.nodes, (node) => {
            return node.isCurrentAuthority === true // Include active nodes only
        }), (node) => {
            return { // Map relevant values
                address: node.idSs58,
                reputation: Number(node.reputationPoints)
            }
        }), (node) => {
            return node.reputation // Sort by reputation (ascending)
        })

        const node = _.find(nodes, (node) => {
            return node.address === this.getNodeAddress()
        })

        if (!node) {
            await log.warn(`${Chainflip.name}:${this.monitorReputation.name}: Node is not active. Skipping reputation monitoring ...`)
            return
        }

        // Calculate best, worst and worst-top-10 threshold
        const best = nodes[nodes.length - 1].reputation
        const worst = nodes[0].reputation
        const worstTop10Threshold = nodes[Math.floor(nodes.length / 10)].reputation

        // Calculate average
        const sum = _.reduce(nodes, (total, node) => total + node.reputation, 0)
        const average = sum / nodes.length

        // Calculate median
        const mid = Math.floor(nodes.length / 2)
        const median = nodes.length % 2 === 0 ? (nodes[mid - 1].reputation + nodes[mid].reputation) / 2 : nodes[mid].reputation

        await log.info(`${Chainflip.name}:Reputation: node = ${node.reputation}; network = ${best} (best), ${median} (median), ${average} (average), ${worstTop10Threshold} (worstTop10Threshold), ${worst} (worst)`)

        // Track metrics
        nodeReputationGauge.set(node.reputation)
        networkReputationBestGauge.set(best)
        networkReputationMedianGauge.set(median)
        networkReputationAverageGauge.set(average)
        networkReputationWorstTop10ThresholdGauge.set(worstTop10Threshold)
        networkReputationWorstGauge.set(worst)

        // Alert if node enters the worst-top-10
        if (node.reputation < worstTop10Threshold) {
            await global.betterStack?.createReputationIncident(Chainflip.name, node.reputation, worstTop10Threshold)
        } else {
            await global.betterStack?.resolveIncidents(Chainflip.name, IncidentType.REPUTATION)
        }
    }

    async monitorPenalties() {
        await log.debug(`${Chainflip.name}: Checking if node has been penalized ...`)

        const syncStateResponse = await super.query('system_syncState')

        if (syncStateResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorChainObservations.name}:system_syncState: HTTP status code: ${syncStateResponse?.status}`)
            return
        }

        const currentBlock = syncStateResponse.data.result.currentBlock
        const penaltiesResponse = await this.queryGraphQL(this.GRAPHQL_PROCESSOR_ENDPOINT, paginatedPenaltiesQuery, {
            first: 1000,
            startBlockId: currentBlock - 10 // Get penalties since the last run (= 1min ago at 6s block time)
        })

        if (penaltiesResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorPenalties.name}:paginatedPenaltiesQuery: HTTP status code: ${penaltiesResponse?.status}`)
            return
        }

        const penalties = _.sortBy(_.map(_.filter(penaltiesResponse.data.data.allPenalties.edges, (penalty) => {
            return penalty.node.validator.idSs58 === this.getNodeAddress()
        }), (penalty) => {
            return { // Map relevant values
                amount: Number(penalty.node.amount),
                reason: penalty.node.reason,
                blockHeight: Number(penalty.node.blockId)
            }
        }), (penalty) => {
            return penalty.blockHeight // Sort by block height (ascending)
        })

        const penaltyAmount = _.reduce(penalties, (total, penalty) => total + penalty.amount, 0)
        const reasons = _.uniq(_.map(penalties, (penalty) => penalty.reason))

        // Track metric
        for (const reason of reasons) {
            const penaltiesForReason = _.filter(penalties, (penalty) => penalty.reason === reason)
            const totalPenaltyAmountForReason = _.reduce(penaltiesForReason, (total, penalty) => total + penalty.amount, 0)
            nodePenaltyGauge.labels(reason).set(totalPenaltyAmountForReason)
        }

        // Alert if node was penalized
        if (penaltyAmount > 0) {
            await global.betterStack?.createPenaltyIncident(Chainflip.name, penaltyAmount, reasons)
        } else {
            await global.betterStack?.resolveIncidents(Chainflip.name, IncidentType.PENALTY)
        }
    }

    async monitorChainObservations() {
        await log.debug(`${Chainflip.name}: Monitoring chain observations ...`)

        const [syncStateResponse, nodeResponse] = await Promise.all([
            super.query('system_syncState'),
            this.queryGraphQL(this.GRAPHQL_PROCESSOR_ENDPOINT, getValidatorLatestBlockInfo, {
                'idSs58': this.getNodeAddress()
            })
        ])

        if (syncStateResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorChainObservations.name}:system_syncState: HTTP status code: ${syncStateResponse?.status}`)
            return
        }
        if (nodeResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorChainObservations.name}:getValidatorLatestBlockInfo: HTTP status code: ${nodeResponse?.status}`)
            return
        }

        const validatorId = nodeResponse.data.data.validators.nodes[0].id
        const currentBlock = syncStateResponse.data.result.currentBlock
        const extrinsicsResponse = await this.queryGraphQL(this.GRAPHQL_PROCESSOR_ENDPOINT, getExtrinsicsByValidator, {
            validatorId: validatorId,
            first: 1000,
            minBlock: currentBlock - 600, // Get extrinsics for the last hour (at 6s block time) in order to include weirdly long Bitcoin block times
            maxBlock: currentBlock
        })

        if (extrinsicsResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorChainObservations.name}:getExtrinsicsByValidator: Node HTTP status code: ${extrinsicsResponse?.status}`)
            return
        }

        const witnessTxs = _.map(_.filter(extrinsicsResponse.data.data.extrinsics.nodes, (extrinsic) => {
            return extrinsic.args?.call?.__kind?.endsWith('ChainTracking') && extrinsic.success === true
        }), (extrinsic) => {
            return { // Map relevant values
                chain: /([a-zA-Z]+)ChainTracking/g.exec(extrinsic.args.call.__kind)![1],
                blockHeight: Number(extrinsic.args.call.value.newChainState.blockHeight)
            }
        })

        const chains = _.uniq(_.map(witnessTxs, (tx) => tx.chain))
        const latestObservations = _.map(chains, (chain) => {
            const witnessTxsForChain = _.filter(witnessTxs, (tx) => tx.chain === chain)
            return _.max(witnessTxsForChain, (tx) => tx.blockHeight)
        }) as [{ chain: string, blockHeight: number }]

        // Log all the observed block heights for all chains
        for (const obversation of latestObservations) {
            await log.info(`${Chainflip.name}:${this.monitorChainObservations.name}: chain = ${obversation.chain}; blockHeight = ${obversation.blockHeight}`)

            // Track metric
            nodeObservedBlockHeightGauge.labels(obversation.chain).set(obversation.blockHeight)
        }
    }

    private getNodeAddress(): string {
        return config.chainflipNodeAddress
    }

    private async queryGraphQL(url: string, query: string, variables?: {}) {
        return await safeAxiosPost(url, {
            query: query,
            variables: variables ?? {}
        }, {})
    }
}
