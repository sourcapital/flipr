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
    help: 'The Chainflip version of the node',
    labelNames: ['version']
})

export const nodeBondGauge = new Gauge({
    name: 'node_bond',
    help: 'The amount of tokens bonded in the node'
})

export const nodeRewardGauge = new Gauge({
    name: 'node_reward',
    help: 'The amount of token rewards of the node'
})

export const networkMinActiveBondGauge = new Gauge({
    name: 'network_min_active_bond',
    help: 'The minimum bond requirement for a node to enter the active set'
})

export const nodeReputationGauge = new Gauge({
    name: 'node_reputation',
    help: 'The reputation points of the node'
})

export const networkReputationBestGauge = new Gauge({
    name: 'network_reputation_best',
    help: 'The best reputation points of any node in the network'
})

export const networkReputationMedianGauge = new Gauge({
    name: 'network_reputation_median',
    help: 'The median reputation points of the nodes in the network'
})

export const networkReputationAverageGauge = new Gauge({
    name: 'network_reputation_average',
    help: 'The average reputation points of the nodes in the network'
})

export const networkReputationWorstTop10ThresholdGauge = new Gauge({
    name: 'network_reputation_worst_top_10_threshold',
    help: 'The worst-top-10 reputation point threshold of the nodes in the network'
})

export const networkReputationWorstGauge = new Gauge({
    name: 'network_reputation_worst',
    help: 'The worst reputation points of any node in the network'
})

export const nodePenaltyGauge = new Gauge({
    name: 'node_penalty',
    help: 'The penalty amount (reputation points) for misbehavior of the node within the last 10 blocks (= ~1min)',
    labelNames: ['reason']
})

export const nodeObservedBlockHeightGauge = new Gauge({
    name: 'node_observed_block_height',
    help: 'The latest block height of a given chain observed & witnessed by the node',
    labelNames: ['chain']
})
