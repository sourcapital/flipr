import {AxiosResponse} from 'axios'
import {Node} from './Node.js'
import {safeAxiosPost} from '../helpers/Axios.js'
import {HeartbeatType} from '../integrations/BetterStack.js'

export enum Chain {
    Polkadot = 'polkadot',
    Chainflip = 'chainflip'
}

const getChainName = (chain: string | Chain): string => {
    return Object.entries(Chain).find(([, val]) => val === chain)?.[0]!
}

export class Polkadot extends Node {
    private readonly chain: Chain

    constructor(url: string, chain?: Chain) {
        super(url)
        this.chain = chain ?? Chain.Polkadot
    }

    async initHeartbeats() {
        await betterStack.initHeartbeats(getChainName(this.chain), [
            HeartbeatType.HEALTH,
            HeartbeatType.SYNC_STATUS
        ])
    }

    async isUp(): Promise<boolean> {
        await log.debug(`${getChainName(this.chain)}: Checking if the node is up ...`)

        const nodeResponse = await this.query('system_health')

        if (nodeResponse?.status !== 200) {
            await log.error(`${getChainName(this.chain)}:${this.isUp.name}:health: Node HTTP status code: ${nodeResponse?.status}`)
            return false
        }

        await log.info(`${getChainName(this.chain)}: Node is up!`)
        await betterStack.sendHeartbeat(getChainName(this.chain), HeartbeatType.HEALTH)

        return true
    }

    async isSynced(): Promise<boolean> {
        await log.debug(`${getChainName(this.chain)}: Checking if the node is synced ...`)

        let apiUrl: string
        switch (this.chain) {
            case Chain.Polkadot:
                apiUrl = 'https://rpc-pdot.chainflip.io'
                break
            case Chain.Chainflip:
                apiUrl = 'xxx' // TODO: Add a chainflip api for cross-checking
                break
        }

        // Await all time critical request together to minimize any delay (e.g. difference in block height)
        const [nodeResponse, apiResponse] = await Promise.all([
            this.query('system_syncState'),
            this.query('system_syncState', apiUrl)
        ])

        if (nodeResponse?.status !== 200) {
            await log.error(`${getChainName(this.chain)}:${this.isSynced.name}:status: Node HTTP status code: ${nodeResponse?.status}`)
            return false
        }
        if (apiResponse?.status !== 200) {
            await log.error(`${getChainName(this.chain)}:${this.isSynced.name}: API HTTP status code: ${apiResponse?.status}`)
            // Continue if the API response is invalid, apiBlockHeight defaults to -1 below
        }

        const nodeCurrentBlock = Number(nodeResponse.data.result.currentBlock)
        const nodeHighestBlock = Number(nodeResponse.data.result.highestBlock)
        const isSyncing = nodeCurrentBlock < nodeHighestBlock
        await log.debug(`${getChainName(this.chain)}:${this.isSynced.name}: isSyncing = ${isSyncing}`)

        // Check if node is still syncing
        if (isSyncing) {
            await log.warn(`${getChainName(this.chain)}:${this.isSynced.name}: Node is still syncing!`)
            return false
        }

        const nodeBlockHeight = nodeCurrentBlock
        const apiBlockHeight = Number(apiResponse?.data.result.currentBlock ?? -1)
        await log.info(`${getChainName(this.chain)}:${this.isSynced.name}: nodeBlockHeight = ${nodeBlockHeight}; apiBlockHeight = ${apiBlockHeight}`)

        // Check if node is behind the api block height (1 block behind is ok due to network latency)
        if (nodeBlockHeight < apiBlockHeight - 1) {
            await log.warn(`${getChainName(this.chain)}:${this.isSynced.name}: nodeBlockHeight < apiBlockHeight: ${nodeBlockHeight} < ${apiBlockHeight}`)
            return false
        }

        await log.info(`${getChainName(this.chain)}: Node is synced!`)
        await betterStack.sendHeartbeat(getChainName(this.chain), HeartbeatType.SYNC_STATUS)

        return true
    }

    protected query(method: string, url?: string, params?: {}): Promise<AxiosResponse | undefined> {
        return safeAxiosPost(url ?? this.url, {
            jsonrpc: '2.0',
            id: 1,
            method: method,
            params: params ?? {}
        }, {})
    }
}
