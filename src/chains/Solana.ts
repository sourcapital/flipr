import { AxiosResponse } from 'axios'
import { Node } from './Node.js'
import { config } from '../config.js'
import { safeAxiosPost } from '../helpers/Axios.js'
import { HeartbeatType } from '../integrations/BetterStack.js'
import {
    nodeBlockHeightGauge,
    apiBlockHeightGauge
} from '../integrations/Prometheus.js'

export enum Chain {
    Solana = 'solana'
}

const getChainName = (chain: string | Chain): string => {
    return Object.entries(Chain).find(([, val]) => val === chain)?.[0]!
}

export class Solana extends Node {
    private readonly chain: Chain

    constructor(url: string, chain?: Chain) {
        super(url)
        this.chain = chain ?? Chain.Solana
    }

    async initHeartbeats() {
        await global.betterStack?.initHeartbeats(getChainName(this.chain), [
            HeartbeatType.HEALTH,
            HeartbeatType.SYNC_STATUS
        ])
    }

    async isUp(): Promise<boolean> {
        await log.debug(`${getChainName(this.chain)}: Checking if the node is up ...`)

        const nodeResponse = await this.query('getHealth')

        if (nodeResponse?.status !== 200 || nodeResponse?.data?.result !== 'ok') {
            await log.error(`${getChainName(this.chain)}:${this.isUp.name}:getHealth: Node HTTP status code: ${nodeResponse?.status}`)
            return false
        }

        await log.info(`${getChainName(this.chain)}: Node is up!`)
        await global.betterStack?.sendHeartbeat(getChainName(this.chain), HeartbeatType.HEALTH)

        return true
    }

    async isSynced(): Promise<boolean> {
        await log.debug(`${getChainName(this.chain)}: Checking if the node is synced ...`)

        let apiUrl: string
        switch (this.chain) {
            case Chain.Solana:
                apiUrl = config.network === 'testnet' ? 'https://api.devnet.solana.com' : 'https://api.mainnet-beta.solana.com'
                break
        }

        // Await all time critical request together to minimize any delay (e.g. difference in block height)
        const [nodeResponse, apiResponse] = await Promise.all([
            this.query('getSlot'),
            this.query('getSlot', apiUrl),
        ])

        if (nodeResponse?.status !== 200) {
            await log.error(`${getChainName(this.chain)}:${this.isSynced.name}:getSlot: Node HTTP status code: ${nodeResponse?.status}`)
            return false
        }
        if (apiResponse?.status !== 200) {
            await log.error(`${getChainName(this.chain)}:${this.isSynced.name}: API HTTP status code: ${apiResponse?.status}`)
            // Continue if the API response is invalid, apiBlockHeight defaults to -1 below
        }

        const nodeBlockHeight = nodeResponse.data.result
        const apiBlockHeight = Number(apiResponse?.data.result ?? -1)
        await log.info(`${getChainName(this.chain)}:${this.isSynced.name}: nodeBlockHeight = ${nodeBlockHeight} apiBlockHeight = ${apiBlockHeight}`)

        // Track metrics
        nodeBlockHeightGauge.labels(getChainName(this.chain)).set(nodeBlockHeight)
        apiBlockHeightGauge.labels(getChainName(this.chain)).set(apiBlockHeight)

        // Check if node is behind the api consensus block height (10 blocks behind is ok due to network latency)
        if (nodeBlockHeight < apiBlockHeight - 10) {
            await log.warn(`${getChainName(this.chain)}:${this.isSynced.name}: nodeBlockHeight < apiBlockHeight: ${nodeBlockHeight} < ${apiBlockHeight}`)
            return false
        }

        await log.info(`${getChainName(this.chain)}: Node is synced!`)
        await global.betterStack?.sendHeartbeat(getChainName(this.chain), HeartbeatType.SYNC_STATUS)

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
