import {AxiosResponse} from 'axios'
import {Node} from './Node.js'
import {config} from '../config.js'
import {safeAxiosPost} from '../helpers/Axios.js'
import {HeartbeatType} from '../integrations/BetterStack.js'
import {
    nodeBlockHeightGauge,
    apiBlockHeightGauge
} from '../integrations/Prometheus.js'

export enum Chain {
    Bitcoin = 'bitcoin'
}

const getChainName = (chain: string | Chain): string => {
    return Object.entries(Chain).find(([, val]) => val === chain)?.[0]!
}

export class Bitcoin extends Node {
    private readonly chain: Chain

    constructor(url: string, chain?: Chain) {
        super(url)
        this.chain = chain ?? Chain.Bitcoin
    }

    async initHeartbeats() {
        await global.betterStack?.initHeartbeats(getChainName(this.chain), [
            HeartbeatType.HEALTH,
            HeartbeatType.SYNC_STATUS
        ])
    }

    async isUp(): Promise<boolean> {
        await log.debug(`${getChainName(this.chain)}: Checking if the node is up ...`)

        const nodeResponse = await this.query('getblockchaininfo')

        if (nodeResponse?.status !== 200) {
            await log.error(`${getChainName(this.chain)}:${this.isUp.name}:getblockchaininfo: Node HTTP status code: ${nodeResponse?.status}`)
            return false
        }

        await log.info(`${getChainName(this.chain)}: Node is up!`)
        await global.betterStack?.sendHeartbeat(getChainName(this.chain), HeartbeatType.HEALTH)

        return true
    }

    async isSynced(): Promise<boolean> {
        await log.debug(`${getChainName(this.chain)}: Checking if the node is synced ...`)

        // Await all time critical request together to minimize any delay (e.g. difference in block height)
        const [nodeResponse, apiResponse] = await Promise.all([
            this.query('getblockchaininfo'),
            this.query('getblockchaininfo', config.nodeEndpoint.bitcoin), // TODO: Use proper api to cross-check upon mainnet release
        ])

        if (nodeResponse?.status !== 200) {
            await log.error(`${getChainName(this.chain)}:${this.isSynced.name}:getblockchaininfo: Node HTTP status code: ${nodeResponse?.status}`)
            return false
        }
        if (apiResponse?.status !== 200) {
            await log.error(`${getChainName(this.chain)}:${this.isSynced.name}: API HTTP status code: ${apiResponse?.status}`)
            // Continue if the API response is invalid, apiBlockHeight defaults to -1 below
        }

        const nodeBlockHeight = nodeResponse.data.result.blocks
        const nodeHeaderHeight = nodeResponse.data.result.headers

        // Check if node is still syncing
        if (nodeBlockHeight < nodeHeaderHeight) {
            await log.warn(`${getChainName(this.chain)}:${this.isSynced.name}: nodeBlockHeight < nodeHeaderHeight: ${nodeBlockHeight} < ${nodeHeaderHeight}`)
            return false
        }

        const apiBlockHeight = Number(apiResponse?.data.result.blocks ?? -1)
        await log.info(`${getChainName(this.chain)}:${this.isSynced.name}: nodeBlockHeight = ${nodeBlockHeight}; apiBlockHeight = ${apiBlockHeight}`)

        // Track metrics
        nodeBlockHeightGauge.labels(getChainName(this.chain)).set(nodeBlockHeight)
        apiBlockHeightGauge.labels(getChainName(this.chain)).set(apiBlockHeight)

        // Check if node is behind the api consensus block height (1 block behind is ok due to network latency)
        if (nodeBlockHeight < apiBlockHeight - 1) {
            await log.warn(`${getChainName(this.chain)}:${this.isSynced.name}: nodeBlockHeight < apiBlockHeight: ${nodeBlockHeight} < ${apiBlockHeight}`)
            return false
        }

        await log.info(`${getChainName(this.chain)}: Node is synced!`)
        await global.betterStack?.sendHeartbeat(getChainName(this.chain), HeartbeatType.SYNC_STATUS)

        return true
    }

    private query(method: string, url?: string, params?: []): Promise<AxiosResponse | undefined> {
        url = url ?? this.url
        let config = undefined

        // Check if the url contains username and password for authentication
        const regex = /(https*:\/\/)([a-z]*):([a-z]*)@([a-zA-Z0-9\/:.-]+)$/g
        if (url.match(regex)) {
            config = {
                auth: {
                    username: url.replace(regex, '$2'),
                    password: url.replace(regex, '$3')
                }
            }
            url = url.replace(regex, '$1') + url.replace(regex, '$4')
        }

        return safeAxiosPost(url, {
            jsonrpc: '1.0',
            id: 1,
            method: method,
            params: params ?? [],
        }, config ?? {})
    }
}
