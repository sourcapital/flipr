import {Gauge} from 'prom-client'

export const nodeBlockHeightGauge = new Gauge({
    name: 'node_block_height',
    help: 'The current block height of a given chain of the node',
    labelNames: ['chain']
})

export const apiBlockHeightGauge = new Gauge({
    name: 'api_block_height',
    help: 'The current block height of a given chain of the API',
    labelNames: ['chain']
})

export const chainflipVersionGauge = new Gauge({
    name: 'chainflip_version',
    help: 'Chainflip node version',
    labelNames: ['version']
})

export const nodeStateGauge = new Gauge({
    name: 'node_state',
    help: 'The current current state of the node',
    labelNames: ['state']
})

export const nodeBondGauge = new Gauge({
    name: 'node_bond',
    help: 'The amount of tokens bonded in the node',
    labelNames: ['type']
})

export const nodeRewardGauge = new Gauge({
    name: 'node_reward',
    help: 'The amount of token rewards of the node',
    labelNames: ['type']
})

export const networkMinActiveBidGauge = new Gauge({
    name: 'network_min_active_bid',
    help: 'The minimum bid requirement for a node to become an authority with the next auction'
})

export const nodeReputationGauge = new Gauge({
    name: 'node_reputation',
    help: 'The reputation points of the node'
})

export const networkReputationGauge = new Gauge({
    name: 'network_reputation',
    help: 'The aggregated reputation points of all nodes in the network',
    labelNames: ['type']
})

export const nodePenaltyGauge = new Gauge({
    name: 'node_penalty',
    help: 'The penalties for misbehavior of the node since the last run',
    labelNames: ['reason']
})

export const nodeObservedBlockHeightGauge = new Gauge({
    name: 'node_observed_block_height',
    help: 'The latest block height of a given chain observed & witnessed by the node',
    labelNames: ['chain']
})
