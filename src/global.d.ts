import {Log} from './helpers/Log.js'
import {Loki} from './integrations/Loki.js'
import {Kubernetes} from './integrations/Kubernetes.js'
import {BetterStack} from './integrations/BetterStack.js'

declare global {
    var sleep: (ms: number) => Promise<unknown>
    var log: Log
    var betterStack: BetterStack | undefined
    var kubernetes: Kubernetes | undefined
    var loki: Loki | undefined
}

export {}
