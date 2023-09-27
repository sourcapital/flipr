import _ from 'underscore'
import {config} from './config.js'
import {Log} from './helpers/Log.js'
import {Cron} from './helpers/Cron.js'
import {Loki} from './integrations/Loki.js'
import {Kubernetes} from './integrations/Kubernetes.js'
import {BetterStack} from './integrations/BetterStack.js'
import {Bitcoin} from './chains/Bitcoin.js'
import {Ethereum} from './chains/Ethereum.js'
import {Polkadot} from './chains/Polkadot.js'
import {Chainflip} from './chains/Chainflip.js'


// Setup globals
global.sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
global.log = new Log()
global.betterStack = new BetterStack(config.betterStack.uptime.apiKey)
global.kubernetes = new Kubernetes()
global.loki = new Loki()

const nodes = [
    new Chainflip(config.nodeEndpoint.chainflip),
    new Bitcoin(config.nodeEndpoint.bitcoin),
    new Ethereum(config.nodeEndpoint.ethereum),
    new Polkadot(config.nodeEndpoint.polkadot)
]

// Setup BetterStack heartbeats (in correct sequence)
await log.info('Setup BetterStack heartbeats ...')
for (const node of nodes) await node.initHeartbeats()
// Setup BetterStack incident cleanup
await log.info('Setup BetterStack incident cleanup ...')
await betterStack.setupCleanup('0 0 * * * *') // once per hour
// Setup k8s pod restart monitoring
// await log.info('Setup k8s pod restart monitoring ...')
// await kubernetes.setupRestartMonitoring('0 * * * * *') // every minute
// Connect to Loki
// await log.info('Setup Loki connection ...')
// await loki.connect()

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

// Monitor version, bond, reputation, penalties & chain observations every minute
await log.info('Setup Chainflip node monitoring ...')
new Cron('0 * * * * *', async () => {
    const chainflip = _.find(nodes, (node) => {
        return node.constructor.name === Chainflip.name
    }) as Chainflip

    await Promise.all([
        chainflip.monitorVersion(),
        chainflip.monitorBond(),
        chainflip.monitorReputation(),
        chainflip.monitorPenalties(),
        chainflip.monitorChainObservations()
    ])
}).run()
