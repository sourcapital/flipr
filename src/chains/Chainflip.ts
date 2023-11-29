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
    getExtrinsicsByValidator,
    getValidators
} from '../helpers/GraphQL.js'
import {
    chainflipVersionGauge,
    nodeStateGauge,
    nodeBondGauge,
    nodeRewardGauge,
    networkMinActiveBidGauge,
    nodeReputationGauge,
    networkReputationGauge,
    nodePenaltyGauge,
    nodeObservedBlockHeightGauge,
} from '../integrations/Prometheus.js'

export class Chainflip extends Polkadot {
    private GRAPHQL_PROCESSOR_ENDPOINT = 'https://explorer-service-processor.chainflip.io/graphql'
    private GRAPHQL_CACHE_ENDPOINT = 'https://cache-service.chainflip.io/graphql'

    private lastBlockMonitoredForPenalties = 0

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

        const response = await super.query('cf_account_info_v2', undefined, {
            'account_id': this.getNodeAddress()
        })

        if (response?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.isUp.name}: Node HTTP status code: ${response?.status}`)
            return false
        }

        if (response.data.result.is_online === false) {
            await log.error(`${Chainflip.name}:${this.isUp.name}: Node is not online!`)
            return false
        }

        await log.info(`${Chainflip.name}: Node is up!`)
        await global.betterStack?.sendHeartbeat(Chainflip.name, HeartbeatType.HEALTH)

        return await super.isUp()
    }

    async monitorVersion() {
        await log.debug(`${Chainflip.name}: Checking if node version is up-to-date ...`)

        const response = await this.queryGraphQL(this.GRAPHQL_PROCESSOR_ENDPOINT, getActiveAuthorityInfo)

        if (response?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorVersion.name}: HTTP status code: ${response?.status}`)
            chainflipVersionGauge.reset()
            chainflipVersionGauge.labels('node', '0.0.0').set(0)
            chainflipVersionGauge.labels('network', '0.0.0').set(0)
            return
        }

        const authorities = response.data.data.epoch.nodes['0'].memberships.nodes

        // Get the top version of the active nodes
        const topVersion = _.max(_.map(authorities, (node) => {
            return node.validator.cfeVersion
        }), (version) => {
            return Number(version.replace(/\./g, ''))
        })
        await log.debug(`${Chainflip.name}:${this.monitorVersion.name}: topVersion = ${topVersion}`)

        const node = _.find(authorities, (node) => {
            return node.validator.idSs58 === this.getNodeAddress()
        })

        if (!node) {
            await log.info(`${Chainflip.name}:${this.monitorVersion.name}: Node '${this.getNodeAddress()}' is not an authority. Skip version monitoring ...`)
            chainflipVersionGauge.reset()
            chainflipVersionGauge.labels('node', '0.0.0').set(0)
            chainflipVersionGauge.labels('network', topVersion).set(1)
            return
        }

        // Get the node's version
        const nodeVersion = node.validator.cfeVersion

        // Parse version as numbers so they can be compared
        const nodeVersionAsNumber = Number(/([0-9]+)\.([0-9]+)\.([0-9]+)/g.exec(nodeVersion)!.slice(1, 4).join(''))
        const topVersionAsNumber = Number(/([0-9]+)\.([0-9]+)\.([0-9]+)/g.exec(topVersion)!.slice(1, 4).join(''))

        // Track metric
        chainflipVersionGauge.reset()
        chainflipVersionGauge.labels('node', nodeVersion).set(1)
        chainflipVersionGauge.labels('network', topVersion).set(1)

        if (nodeVersionAsNumber < topVersionAsNumber) {
            await log.warn(`${Chainflip.name}:${this.monitorVersion.name}: nodeVersion < topVersion: '${nodeVersion}' < '${topVersion}'`)
            return
        }

        await log.info(`${Chainflip.name}: Node version is up-to-date!`)
        await global.betterStack?.sendHeartbeat(Chainflip.name, HeartbeatType.VERSION)
    }

    async monitorStates() {
        await log.debug(`${Chainflip.name}: Monitor node state ...`)

        const resetMetrics = () => {
            nodeStateGauge.labels('authority').set(0)
            nodeStateGauge.labels('backup').set(0)
            nodeStateGauge.labels('qualified').set(0)
            nodeStateGauge.labels('online').set(0)
            nodeStateGauge.labels('bidding').set(0)
            nodeStateGauge.labels('keyholder').set(0)
        }

        const response = await this.queryGraphQL(this.GRAPHQL_CACHE_ENDPOINT, getActiveCacheValidators)

        if (response?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorStates.name}: Node HTTP status code: ${response?.status}`)
            resetMetrics()
            return
        }

        const node = _.find(response.data.data.validators.nodes, (node) => {
            return node.idSs58 === this.getNodeAddress()
        })

        if (!node) {
            await log.warn(`${Chainflip.name}:${this.monitorStates.name}: Node is not registered. Skip state monitoring ...`)
            resetMetrics()
            return
        }

        // Get node states
        const isAuthority = Number(node.isCurrentAuthority)
        const isBackup = Number(node.isCurrentBackup)
        const isQualified = Number(node.isQualified)
        const isOnline = Number(node.isOnline)
        const isBidding = Number(node.isBidding)
        const isKeyholder = Number(node.isKeyholder)

        // Track metrics
        nodeStateGauge.labels('authority').set(isAuthority)
        nodeStateGauge.labels('backup').set(isBackup)
        nodeStateGauge.labels('qualified').set(isQualified)
        nodeStateGauge.labels('online').set(isOnline)
        nodeStateGauge.labels('bidding').set(isBidding)
        nodeStateGauge.labels('keyholder').set(isKeyholder)

        await log.info(`${Chainflip.name}:State: authority = ${isAuthority}; backup = ${isBackup}; qualified = ${isQualified}; online = ${isOnline}; bidding = ${isBidding}; keyholder = ${isKeyholder}`)
    }

    async monitorBond() {
        await log.debug(`${Chainflip.name}: Monitoring bond ...`)

        const resetMetrics = () => {
            nodeBondGauge.labels('lockedBond').set(0)
            nodeBondGauge.labels('unlockedBond').set(0)
            nodeBondGauge.labels('totalBond').set(0)
            nodeRewardGauge.labels('epochRewards').set(0)
            nodeRewardGauge.labels('totalRewards').set(0)
            networkMinActiveBidGauge.set(0)
        }

        const [validatorResponse, auctionResponse, authorityResponse] = await Promise.all([
            this.queryGraphQL(this.GRAPHQL_CACHE_ENDPOINT, getValidators),
            this.queryGraphQL(this.GRAPHQL_CACHE_ENDPOINT, getLatestAuction),
            this.queryGraphQL(this.GRAPHQL_PROCESSOR_ENDPOINT, getActiveAuthorityInfo)
        ])

        if (validatorResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorBond.name}:getValidators: HTTP status code: ${validatorResponse?.status}`)
            resetMetrics()
            return
        }
        if (auctionResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorBond.name}:getLatestAuction: HTTP status code: ${auctionResponse?.status}`)
            resetMetrics()
            return
        }
        if (authorityResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorBond.name}:getActiveAuthorityInfo: HTTP status code: ${authorityResponse?.status}`)
            resetMetrics()
            return
        }

        const node = _.find(_.map(validatorResponse.data.data.validators.nodes, (node) => {
            return { // Map relevant values
                address: node.idSs58,
                lockedBalance: Number(node.lockedBalance) / 1e18,
                unlockedBalance: Number(node.unlockedBalance) / 1e18,
                totalRewards: Number(node.totalRewards) / 1e18
            }
        }), (node) => {
            return node.address === this.getNodeAddress() // Find node by address
        })

        if (!node) {
            await log.warn(`${Chainflip.name}:${this.monitorBond.name}: Node '${this.getNodeAddress()}' not registered. Skip bond monitoring ...`)
            resetMetrics()
            return
        }

        const authorities = authorityResponse.data.data.epoch.nodes['0'].memberships.nodes

        const authority = _.find(authorities, (node) => {
            return node.validator.idSs58 === this.getNodeAddress()
        })

        const lockedBond = node.lockedBalance
        const unlockedBond = node.unlockedBalance
        const totalBond = lockedBond + unlockedBond
        const epochRewards = Number((authority?.reward ?? 0) / 1e18)
        const totalRewards = node.totalRewards
        const minActiveBid = Number(auctionResponse.data.data.auction.minActiveBid) / 1e18

        // Track metrics
        nodeBondGauge.labels('lockedBond').set(lockedBond)
        nodeBondGauge.labels('unlockedBond').set(unlockedBond)
        nodeBondGauge.labels('totalBond').set(totalBond)
        nodeRewardGauge.labels('epochRewards').set(epochRewards)
        nodeRewardGauge.labels('totalRewards').set(totalRewards)
        networkMinActiveBidGauge.set(minActiveBid)

        await log.info(`${Chainflip.name}:Bond: lockedBond = ${lockedBond}; unlockedBond = ${unlockedBond}; totalBond = ${totalBond}; epochRewards = ${epochRewards}; totalRewards = ${totalRewards}; minActiveBid = ${minActiveBid}`)
    }

    async monitorReputation() {
        await log.debug(`${Chainflip.name}: Monitoring reputation ...`)

        const resetMetrics = () => {
            nodeReputationGauge.set(0)
            networkReputationGauge.labels('best').set(0)
            networkReputationGauge.labels('median').set(0)
            networkReputationGauge.labels('average').set(0)
            networkReputationGauge.labels('worstTop10Threshold').set(0)
            networkReputationGauge.labels('worst').set(0)
        }

        const response = await this.queryGraphQL(this.GRAPHQL_CACHE_ENDPOINT, getValidators)

        if (response?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorReputation.name}: Node HTTP status code: ${response?.status}`)
            resetMetrics()
            return
        }

        const nodes = _.sortBy(_.map(response.data.data.validators.nodes, (node) => {
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
            await log.warn(`${Chainflip.name}:${this.monitorReputation.name}: Node is not registered. Skip reputation monitoring ...`)
            resetMetrics()
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

        // Track metric
        nodeReputationGauge.set(node.reputation)
        networkReputationGauge.labels('best').set(best)
        networkReputationGauge.labels('median').set(median)
        networkReputationGauge.labels('average').set(average)
        networkReputationGauge.labels('worstTop10Threshold').set(worstTop10Threshold)
        networkReputationGauge.labels('worst').set(worst)

        // Alert if node enters the worst-top-10
        if (node.reputation < worstTop10Threshold) {
            await global.betterStack?.createReputationIncident(Chainflip.name, node.reputation, worstTop10Threshold)
        } else {
            await global.betterStack?.resolveIncidents(Chainflip.name, IncidentType.REPUTATION)
        }
    }

    async monitorPenalties() {
        await log.debug(`${Chainflip.name}: Checking if node has been penalized ...`)

        nodePenaltyGauge.reset()

        const syncStateResponse = await super.query('system_syncState')

        if (syncStateResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorChainObservations.name}:system_syncState: HTTP status code: ${syncStateResponse?.status}`)
            return
        }

        const currentBlock = syncStateResponse.data.result.currentBlock

        const penaltiesResponse = await this.queryGraphQL(this.GRAPHQL_PROCESSOR_ENDPOINT, paginatedPenaltiesQuery, {
            first: 1000,
            startBlockId: Math.min(currentBlock - this.lastBlockMonitoredForPenalties, 100) // Get penalties since the last run (default to last 100 blocks ~ 10mins)
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

        // Track metrics
        for (const reason of reasons) {
            const penaltiesForReason = _.filter(penalties, (penalty) => penalty.reason === reason)
            const totalPenaltyAmountForReason = _.reduce(penaltiesForReason, (total, penalty) => total + penalty.amount, 0)
            nodePenaltyGauge.labels(reason).set(totalPenaltyAmountForReason)
        }

        // Remember last monitored block height
        this.lastBlockMonitoredForPenalties = currentBlock

        // Alert if node was penalized
        if (penaltyAmount > 0) {
            await global.betterStack?.createPenaltyIncident(Chainflip.name, penaltyAmount, reasons)
        } else {
            await global.betterStack?.resolveIncidents(Chainflip.name, IncidentType.PENALTY)
        }
    }

    async monitorChainObservations() {
        await log.debug(`${Chainflip.name}: Monitoring chain observations ...`)

        const resetMetrics = () => {
            nodeObservedBlockHeightGauge.labels('Bitcoin').set(0)
            nodeObservedBlockHeightGauge.labels('Ethereum').set(0)
            nodeObservedBlockHeightGauge.labels('Polkadot').set(0)
        }

        const [syncStateResponse, latestBlockInfoResponse] = await Promise.all([
            super.query('system_syncState'),
            this.queryGraphQL(this.GRAPHQL_PROCESSOR_ENDPOINT, getValidatorLatestBlockInfo, {
                'idSs58': this.getNodeAddress()
            })
        ])

        if (syncStateResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorChainObservations.name}:system_syncState: HTTP status code: ${syncStateResponse?.status}`)
            resetMetrics()
            return
        }
        if (latestBlockInfoResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorChainObservations.name}:getValidatorLatestBlockInfo: HTTP status code: ${latestBlockInfoResponse?.status}`)
            resetMetrics()
            return
        }

        const validatorId = latestBlockInfoResponse.data.data.validators.nodes[0].id
        const currentBlock = syncStateResponse.data.result.currentBlock
        const extrinsicsResponse = await this.queryGraphQL(this.GRAPHQL_PROCESSOR_ENDPOINT, getExtrinsicsByValidator, {
            validatorId: validatorId,
            first: 1000,
            minBlock: currentBlock - 600, // Get extrinsics for the last ~60min (at 6s block time) to include very long Bitcoin block times
            maxBlock: currentBlock
        })

        if (extrinsicsResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorChainObservations.name}:getExtrinsicsByValidator: Node HTTP status code: ${extrinsicsResponse?.status}`)
            resetMetrics()
            return
        }

        const witnessTxs = _.map(_.filter(extrinsicsResponse.data.data.extrinsics.nodes, (extrinsic) => {
            return extrinsic.args?.call?.__kind?.endsWith('ChainTracking')
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
