import {Ethereum, Chain} from './Ethereum.js'

export class Arbitrum extends Ethereum {
    constructor(url: string) {
        super(url, Chain.Arbitrum)
    }
}
