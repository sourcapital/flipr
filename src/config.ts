export const config = {
    nodeENV: process.env.NODE_ENV,
    betterStack: {
        uptime: {
            apiKey: process.env.BETTERSTACK_API_KEY!
        },
        logs: {
            sourceToken: process.env.LOGS_SOURCE_TOKEN
        },
    },
    chainflipNodeAddress: process.env.CHAINFLIP_NODE_ADDRESS!,
    nodeEndpoint: {
        chainflip: process.env.NODE_ENDPOINT_CHAINFLIP!,
        bitcoin: process.env.NODE_ENDPOINT_BITCOIN!,
        ethereum: process.env.NODE_ENDPOINT_ETHEREUM!,
        polkadot: process.env.NODE_ENDPOINT_POLKADOT!
    }
}
