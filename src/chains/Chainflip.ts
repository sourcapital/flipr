import _ from 'underscore'
import {config} from '../config.js'
import {Chain, Polkadot} from './Polkadot.js'
import {safeAxiosPost} from '../helpers/Axios.js'
import {HeartbeatType, IncidentType} from '../integrations/BetterStack.js'
import {
    getLatestAuction,
    getValidatorLatestBlockInfo,
    getValidators,
    getValidatorByIdSs58,
    getActiveAuthorityInfo,
    getAuthorityMembershipsForValidator,
    paginatedPenaltiesByValidatorQuery,
    getExtrinsicsByAccount
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
    private readonly GRAPHQL_CACHE_ENDPOINT
    private readonly GRAPHQL_PROCESSOR_ENDPOINT

    private lastBlockMonitoredForPenalties = 0

    constructor(url: string) {
        super(url, Chain.Substrate)

        if (config.network === 'testnet') {
            this.GRAPHQL_CACHE_ENDPOINT = 'https://chainflip-cache-perseverance.chainflip.io/graphql'
            this.GRAPHQL_PROCESSOR_ENDPOINT = 'https://processor-perseverance.chainflip.io/graphql'
        } else {
            this.GRAPHQL_CACHE_ENDPOINT = 'https://cache-service.chainflip.io/graphql'
            this.GRAPHQL_PROCESSOR_ENDPOINT = 'https://explorer-service-processor.chainflip.io/graphql'
        }
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

        const [activeValidatorResponse, targetValidatorResponse] = await Promise.all([
            this.queryGraphQL(this.GRAPHQL_PROCESSOR_ENDPOINT, getActiveAuthorityInfo),
            this.queryGraphQL(this.GRAPHQL_PROCESSOR_ENDPOINT, getValidatorLatestBlockInfo, {
                'idSs58': this.getNodeAddress()
            })
        ])

        if (activeValidatorResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorVersion.name}:getActiveAuthorityInfo: HTTP status code: ${activeValidatorResponse?.status}`)
            chainflipVersionGauge.reset()
            chainflipVersionGauge.labels('node', '0.0.0').set(0)
            chainflipVersionGauge.labels('network', '0.0.0').set(0)
            return
        }
        if (targetValidatorResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorVersion.name}:getValidatorLatestBlockInfo: HTTP status code: ${targetValidatorResponse?.status}`)
            chainflipVersionGauge.reset()
            chainflipVersionGauge.labels('node', '0.0.0').set(0)
            chainflipVersionGauge.labels('network', '0.0.0').set(0)
            return
        }

        const nodes = activeValidatorResponse.data.data.epoch.nodes['0'].memberships.nodes
        const versions = _.map(nodes, (node) => {
            return node.validator.cfeVersion
        })
        const versionCounts = _.countBy(versions)
        const majorityAuthorityVersion = String(_.max(_.keys(versionCounts), version => versionCounts[version]))
        await log.debug(`${Chainflip.name}:${this.monitorVersion.name}: majorityAuthorityVersion = ${majorityAuthorityVersion}`)

        const node = targetValidatorResponse.data.data.accounts.nodes['0'].validators.nodes['0']

        // Track metric
        chainflipVersionGauge.reset()
        chainflipVersionGauge.labels('node', node.cfeVersion).set(1)
        chainflipVersionGauge.labels('network', majorityAuthorityVersion).set(1)

        if (node.cfeVersion !== majorityAuthorityVersion) {
            await log.warn(`${Chainflip.name}:${this.monitorVersion.name}: nodeVersion != majorityAuthorityVersion: '${node.cfeVersion}' != '${majorityAuthorityVersion}'`)
            return
        }

        await log.info(`${Chainflip.name}: Node version is up-to-date!`)
        await global.betterStack?.sendHeartbeat(Chainflip.name, HeartbeatType.VERSION)
    }

    async monitorState() {
        await log.debug(`${Chainflip.name}: Monitor node state ...`)

        const resetMetrics = () => {
            nodeStateGauge.labels('authority').set(0)
            nodeStateGauge.labels('backup').set(0)
            nodeStateGauge.labels('qualified').set(0)
            nodeStateGauge.labels('online').set(0)
            nodeStateGauge.labels('bidding').set(0)
            nodeStateGauge.labels('keyholder').set(0)
        }

        const response = await this.queryGraphQL(this.GRAPHQL_CACHE_ENDPOINT, getValidatorByIdSs58, {
            'validatorId': this.getNodeAddress()
        })

        if (response?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorState.name}: Node HTTP status code: ${response?.status}`)
            resetMetrics()
            return
        }

        const node = _.first(response.data.data.validators.nodes)

        if (!node) {
            await log.warn(`${Chainflip.name}:${this.monitorState.name}: Node '${this.getNodeAddress()}' not registered. Skip state monitoring ...`)
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

        const [validatorResponse, auctionResponse, latestBlockInfoResponse] = await Promise.all([
            this.queryGraphQL(this.GRAPHQL_CACHE_ENDPOINT, getValidators),
            this.queryGraphQL(this.GRAPHQL_CACHE_ENDPOINT, getLatestAuction),
            this.queryGraphQL(this.GRAPHQL_PROCESSOR_ENDPOINT, getValidatorLatestBlockInfo, {
                'idSs58': this.getNodeAddress()
            })
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
        if (latestBlockInfoResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorBond.name}:getValidatorLatestBlockInfo: HTTP status code: ${latestBlockInfoResponse?.status}`)
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

        const nodeId = latestBlockInfoResponse.data.data.accounts.nodes['0'].id

        const [authorityResponse] = await Promise.all([
            this.queryGraphQL(this.GRAPHQL_PROCESSOR_ENDPOINT, getAuthorityMembershipsForValidator, {
                'validatorId': nodeId,
                'accountId': nodeId,
                'first': 1
            })
        ])

        if (authorityResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorBond.name}:getAuthorityMembershipsForValidator: HTTP status code: ${authorityResponse?.status}`)
            resetMetrics()
            return
        }

        const authority = authorityResponse.data.data.memberships.edges['0'].node

        const lockedBond = node.lockedBalance
        const unlockedBond = node.unlockedBalance
        const totalBond = lockedBond + unlockedBond
        const epochRewards = authority.epoch.endBlockId == null ? Number(authority.reward) / 1e18 : 0
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

        const nodes = _.sortBy(_.map(_.filter(response.data.data.validators.nodes, (node) => {
            return node.isCurrentAuthority || node.isCurrentBackup // Filter active nodes
        }), (node) => {
            return { // Map relevant values
                address: node.idSs58,
                reputation: Number(node.reputationPoints),
                isCurrentAuthority: node.isCurrentAuthority,
                isCurrentBackup: node.isCurrentBackup
            }
        }), (node) => {
            return node.reputation // Sort by reputation (ascending)
        })

        const node = _.find(nodes, (node) => {
            return node.address === this.getNodeAddress()
        })

        if (!node) {
            await log.warn(`${Chainflip.name}:${this.monitorReputation.name}: Node '${this.getNodeAddress()}' not registered. Skip reputation monitoring ...`)
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

        // Alert if node has below 2000 reputation
        if (node.reputation < 2000) {
            await global.betterStack?.createReputationIncident(Chainflip.name, node.reputation)
        } else {
            await global.betterStack?.resolveIncidents(Chainflip.name, IncidentType.REPUTATION)
        }
    }

    async monitorPenalties() {
        await log.debug(`${Chainflip.name}: Checking if node has been penalized ...`)

        nodePenaltyGauge.reset()

        const syncStateResponse = await super.query('system_syncState')

        if (syncStateResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorPenalties.name}:system_syncState: HTTP status code: ${syncStateResponse?.status}`)
            return
        }

        const currentBlock = syncStateResponse.data.result.currentBlock

        if (this.lastBlockMonitoredForPenalties == 0) {
            this.lastBlockMonitoredForPenalties = currentBlock
        }

        const [validatorResponse] = await Promise.all([
            this.queryGraphQL(this.GRAPHQL_PROCESSOR_ENDPOINT, getValidatorLatestBlockInfo, {
                'idSs58': this.getNodeAddress()
            })
        ])

        if (validatorResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorPenalties.name}:getValidatorLatestBlockInfo: HTTP status code: ${validatorResponse?.status}`)
            return
        }

        const validatorId = validatorResponse.data.data.accounts.nodes['0'].id

        const penaltiesResponse = await this.queryGraphQL(this.GRAPHQL_PROCESSOR_ENDPOINT, paginatedPenaltiesByValidatorQuery, {
            validatorId: validatorId,
            first: 1000
        })

        if (penaltiesResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorPenalties.name}:paginatedPenaltiesByValidatorQuery: HTTP status code: ${penaltiesResponse?.status}`)
            return
        }
        if (penaltiesResponse?.data?.errors?.length !== 0) {
            await log.error(`${Chainflip.name}:${this.monitorPenalties.name}:paginatedPenaltiesByValidatorQuery: ${penaltiesResponse.data.errors[0].message}`)
            return
        }

        const penalties = _.sortBy(_.map(_.filter(penaltiesResponse.data.data.penalties.edges, (penalty) => {
            return penalty.node.block.id > this.lastBlockMonitoredForPenalties
        }), (penalty) => {
            return { // Map relevant values
                amount: Number(penalty.node.amount),
                reason: penalty.node.reason,
                blockHeight: Number(penalty.node.block.id)
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

        const [validatorResponse1, validatorResponse2] = await Promise.all([
            this.queryGraphQL(this.GRAPHQL_PROCESSOR_ENDPOINT, getValidatorLatestBlockInfo, {
                'idSs58': this.getNodeAddress()
            }),
            this.queryGraphQL(this.GRAPHQL_CACHE_ENDPOINT, getValidatorByIdSs58, {
                'validatorId': this.getNodeAddress()
            })
        ])

        if (validatorResponse1?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorChainObservations.name}:getValidatorLatestBlockInfo: HTTP status code: ${validatorResponse1?.status}`)
            resetMetrics()
            return
        }
        if (validatorResponse2?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorChainObservations.name}:getValidatorByIdSs58: HTTP status code: ${validatorResponse2?.status}`)
            resetMetrics()
            return
        }

        const validatorId = validatorResponse1.data.data.accounts.nodes['0'].id
        const isCurrentAuthority = validatorResponse2.data.data.validators.nodes['0'].isCurrentAuthority

        if (!isCurrentAuthority) {
            await log.warn(`${Chainflip.name}:${this.monitorChainObservations.name}: Node '${this.getNodeAddress()}' not an authority. Skip chain observation monitoring ...`)
            resetMetrics()
            return
        }

        const extrinsicsResponse = await this.queryGraphQL(this.GRAPHQL_PROCESSOR_ENDPOINT, getExtrinsicsByAccount, {
            accountId: validatorId,
            first: 1000
        })

        if (extrinsicsResponse?.status !== 200) {
            await log.error(`${Chainflip.name}:${this.monitorChainObservations.name}:getExtrinsicsByAccount: Node HTTP status code: ${extrinsicsResponse?.status}`)
            resetMetrics()
            return
        }
        if (extrinsicsResponse?.data?.errors !== undefined) {
            await log.warn(`${Chainflip.name}:${this.monitorChainObservations.name}:getExtrinsicsByAccount: Unable to get extrinsics: ${extrinsicsResponse.data.errors['0'].message}`)
            resetMetrics()
            return
        }

        const witnessTxs = _.map(_.filter(extrinsicsResponse.data.data.extrinsics.edges, (extrinsic) => {
            return extrinsic.node.args?.call?.__kind?.endsWith('ChainTracking') ?? false
        }), (extrinsic) => {
            return { // Map relevant values
                chain: /([a-zA-Z]+)ChainTracking/g.exec(extrinsic.node.args.call.__kind)![1],
                blockHeight: Number(extrinsic.node.args.call.value.newChainState.blockHeight)
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
