import _ from 'underscore'
import {config} from './config.js'
import {Log} from './helpers/Log.js'
import {Cron} from './helpers/Cron.js'
import {Kubernetes} from './integrations/Kubernetes.js'
import {Loki} from './integrations/Loki.js'
import {BetterUptime} from './integrations/BetterUptime.js'
import {Node} from './chains/Node.js'
import {Thornode} from './chains/Thornode.js'
import {Binance} from './chains/Binance.js'
import {Bitcoin} from './chains/Bitcoin.js'
import {Ethereum} from './chains/Ethereum.js'
import {Litecoin} from './chains/Litecoin.js'
import {BitcoinCash} from './chains/BitcoinCash.js'
import {Dogecoin} from './chains/Dogecoin.js'
import {Cosmos} from './chains/Cosmos.js'
import {Avalanche} from './chains/Avalanche.js'

// Setup globals
global.sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
global.log = new Log()
global.betterUptime = new BetterUptime(config.betterUptime.apiKey)
global.kubernetes = new Kubernetes()
global.loki = new Loki()

// Init nodes
let nodes: Array<Node>
if (config.nodeENV === 'production') {
    nodes = [
        // Suffix all kube-dns hostnames with the 'thornode' namespace in order to reach them
        new Thornode('http://thornode.thornode:1317', 'http://thornode.thornode:27147'),
        new Binance('http://binance-daemon.thornode:27147'),
        new Bitcoin('http://thorchain:password@bitcoin-daemon.thornode:8332'),
        new Ethereum('http://ethereum-daemon.thornode:8545'),
        new Litecoin('http://thorchain:password@litecoin-daemon.thornode:9332'),
        new BitcoinCash('http://thorchain:password@bitcoin-cash-daemon.thornode:8332'),
        new Dogecoin('http://thorchain:password@dogecoin-daemon.thornode:22555'),
        new Cosmos('http://gaia-daemon.thornode:26657'),
        new Avalanche('http://avalanche-daemon.thornode:9650/ext/bc/C/rpc'),
        // new BinanceSmartChain('http://binance-smart-daemon.thornode:8545')
    ]
} else {
    nodes = [
        new Thornode('https://thornode.ninerealms.com', 'https://rpc.ninerealms.com'),
        new Binance('https://binance.ninerealms.com'),
        new Bitcoin('https://thorchain:password@bitcoin.ninerealms.com'),
        new Ethereum('https://ethereum.ninerealms.com'),
        new Litecoin('https://thorchain:password@litecoin.ninerealms.com'),
        new BitcoinCash('https://thorchain:password@bitcoin-cash.ninerealms.com'),
        new Dogecoin('https://thorchain:password@dogecoin.ninerealms.com'),
        new Cosmos('https://gaia.ninerealms.com'),
        new Avalanche('https://avalanche.ninerealms.com/ext/bc/C/rpc'),
        // new BinanceSmartChain('https://binance-smart.ninerealms.com')
    ]
}

// Setup BetterUptime heartbeats (in correct sequence)
await log.info('Setup BetterUptime heartbeats ...')
for (const node of nodes) await node.initHeartbeats()
// Setup BetterUptime incident cleanup
await log.info('Setup BetterUptime incident cleanup ...')
await betterUptime.setupCleanup('0 0 * * * *') // once per hour
// Setup k8s pod restart monitoring
await log.info('Setup k8s pod restart monitoring ...')
await kubernetes.setupRestartMonitoring('0 * * * * *') // every minute
// Connect to Loki
await log.info('Setup Loki connection ...')
await loki.connect()

// Run node health monitoring every minute
await log.info('Setup chain daemon monitoring ...')
new Cron('0 * * * * *', async () => {
    await Promise.all(_.flatten(_.map(nodes, (node) => {
        return [
            node.isUp(),
            node.isSynced()
        ]
    })))
}).run()

// Monitor version, bond slash points, jailing & chain observations every minute
await log.info('Setup THORNode monitoring ...')
new Cron('0 * * * * *', async () => {
    const thornode = _.find(nodes, (node) => {
        return node.constructor.name === Thornode.name
    }) as Thornode

    await Promise.all([
        thornode.monitorVersion(),
        thornode.monitorBond(),
        thornode.monitorSlashPoints(),
        thornode.monitorJailing(),
        thornode.monitorChainObservations()
    ])
}).run()
