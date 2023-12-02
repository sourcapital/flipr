import _ from 'underscore'
import express from 'express'
import {register} from 'prom-client'
import {config} from './config.js'
import {Log} from './helpers/Log.js'
import {Cron} from './helpers/Cron.js'
import {BetterStack} from './integrations/BetterStack.js'
import {Node} from './chains/Node.js'
import {Bitcoin} from './chains/Bitcoin.js'
import {Ethereum} from './chains/Ethereum.js'
import {Polkadot} from './chains/Polkadot.js'
import {Chainflip} from './chains/Chainflip.js'


// Setup globals
global.sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
global.log = new Log()

// Init BetterStack only if the API key is set
if (config.betterStack.uptime.apiKey) {
    global.betterStack = new BetterStack(config.betterStack.uptime.apiKey)
}

// Init nodes
const nodes: Node[] = [
    new Chainflip(config.nodeEndpoint.chainflip)
]
if (config.nodeEndpoint.bitcoin) nodes.push(new Bitcoin(config.nodeEndpoint.bitcoin))
if (config.nodeEndpoint.ethereum) nodes.push(new Ethereum(config.nodeEndpoint.ethereum))
if (config.nodeEndpoint.polkadot) nodes.push(new Polkadot(config.nodeEndpoint.polkadot))

// Only do BetterStack stuff if it's enabled
if (global.betterStack) {
    // Setup BetterStack heartbeats (in correct sequence)
    await log.info('Setup BetterStack heartbeats ...')
    for (const node of nodes) {
        await node.initHeartbeats()
    }
    // Setup BetterStack incident cleanup to run once per hour
    await log.info('Setup BetterStack incident cleanup ...')
    await global.betterStack.setupCleanup('0 0 * * * *')
}

// Run basic node health monitoring
await log.info('Setup chain daemon monitoring ...')
new Cron(config.cron_schedule ?? '0 */3 * * * *', async () => {
    await Promise.all(_.flatten(_.map(nodes, (node) => {
        return [
            node.isUp(),
            node.isSynced()
        ]
    })))
}).run()

// Run Chainflip node specific monitoring
await log.info('Setup Chainflip node monitoring ...')
new Cron(config.cron_schedule ?? '0 */3 * * * *', async () => {
    const chainflip = _.find(nodes, (node) => {
        return node.constructor.name === Chainflip.name
    }) as Chainflip

    await Promise.all([
        chainflip.monitorVersion(),
        chainflip.monitorState(),
        chainflip.monitorBond(),
        chainflip.monitorReputation(),
        chainflip.monitorPenalties(),
        chainflip.monitorChainObservations()
    ])
}).run()

// Run metrics server
const app = express()

app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType)
    res.end(await register.metrics())
})

app.get('/healthz', (req, res) => {
    res.sendStatus(200)
})

app.listen(3000, async () => {
    await log.info(`Start metrics server at http://localhost:3000/metrics ...`)
})
