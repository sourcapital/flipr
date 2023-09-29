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
    Ethereum = 'ethereum'
}

const getChainName = (chain: string | Chain): string => {
    return Object.entries(Chain).find(([, val]) => val === chain)?.[0]!
}

export class Ethereum extends Node {
    private readonly chain: Chain

    constructor(url: string, chain?: Chain) {
        super(url)
        this.chain = chain ?? Chain.Ethereum
    }

    async initHeartbeats() {
        await betterStack?.initHeartbeats(getChainName(this.chain), [
            HeartbeatType.HEALTH,
            HeartbeatType.SYNC_STATUS
        ])
    }

    async isUp(): Promise<boolean> {
        await log.debug(`${getChainName(this.chain)}: Checking if the node is up ...`)

        const nodeResponse = await this.query('eth_syncing')

        if (nodeResponse?.status !== 200) {
            await log.error(`${getChainName(this.chain)}:${this.isUp.name}:eth_syncing: Node HTTP status code: ${nodeResponse?.status}`)
            return false
        }

        await log.info(`${getChainName(this.chain)}: Node is up!`)
        await betterStack?.sendHeartbeat(getChainName(this.chain), HeartbeatType.HEALTH)

        return true
    }

    async isSynced(): Promise<boolean> {
        await log.debug(`${getChainName(this.chain)}: Checking if the node is synced ...`)

        let apiUrl: string
        switch (this.chain) {
            case Chain.Ethereum:
                apiUrl = config.nodeEndpoint.ethereum // TODO: Use proper api to cross-check upon mainnet release
                break
        }

        // Await all time critical request together to minimize any delay (e.g. difference in block height)
        const [nodeResponseSync, nodeResponseBlockNumber, apiResponse] = await Promise.all([
            this.query('eth_syncing'),
            this.query('eth_blockNumber'),
            this.query('eth_blockNumber', apiUrl)
        ])

        if (nodeResponseSync?.status !== 200) {
            await log.error(`${getChainName(this.chain)}:${this.isSynced.name}:eth_syncing: Node HTTP status code: ${nodeResponseSync?.status}`)
            return false
        }
        if (nodeResponseBlockNumber?.status !== 200) {
            await log.error(`${getChainName(this.chain)}:${this.isSynced.name}:eth_blockNumber: Node HTTP status code: ${nodeResponseBlockNumber?.status}`)
            return false
        }
        if (apiResponse?.status !== 200) {
            await log.error(`${getChainName(this.chain)}:${this.isSynced.name}: API HTTP status code: ${apiResponse?.status}`)
            // Continue if the API response is invalid, apiBlockHeight defaults to -1 below
        }

        const isSyncing = nodeResponseSync.data.result
        await log.debug(`${getChainName(this.chain)}:${this.isSynced.name}: isSyncing = ${isSyncing}`)

        // Check if node is still syncing
        if (isSyncing) {
            await log.warn(`${getChainName(this.chain)}:${this.isSynced.name}: Node is still syncing!`)
            return false
        }

        const nodeBlockHeight = Number(nodeResponseBlockNumber.data.result)
        const apiBlockHeight = Number(apiResponse?.data.result ?? -1)
        await log.info(`${getChainName(this.chain)}:${this.isSynced.name}: nodeBlockHeight = ${nodeBlockHeight}; apiBlockHeight = ${apiBlockHeight}`)

        // Track metrics
        nodeBlockHeightGauge.labels(getChainName(this.chain)).set(nodeBlockHeight)
        apiBlockHeightGauge.labels(getChainName(this.chain)).set(apiBlockHeight)

        // Check if node is behind the api block height (1 block behind is ok due to network latency)
        if (nodeBlockHeight < apiBlockHeight - 1) {
            await log.warn(`${getChainName(this.chain)}:${this.isSynced.name}: nodeBlockHeight < apiBlockHeight: ${nodeBlockHeight} < ${apiBlockHeight}`)
            return false
        }

        await log.info(`${getChainName(this.chain)}: Node is synced!`)
        await betterStack?.sendHeartbeat(getChainName(this.chain), HeartbeatType.SYNC_STATUS)

        return true
    }

    private query(method: string, url?: string, params?: []): Promise<AxiosResponse | undefined> {
        return safeAxiosPost(url ?? this.url, {
            jsonrpc: '2.0',
            id: 1,
            method: method,
            params: params ?? []
        }, {})
    }
}
