import _ from 'underscore'
import k8s, {KubeConfig} from '@kubernetes/client-node'
import {config} from '../config.js'
import {Cron} from '../helpers/Cron.js'
import {IncidentType} from './BetterStack.js'

declare type K8sPod = {
    name: string,
    namespace: string,
    container: Container,
    restarts: number
}

enum Container {
    Chainflip = 'chainflip-daemon',
    Bitcoin = 'bitcoin-daemon',
    Ethereum = 'ethereum-daemon',
    Polkadot = 'polkadot-daemon'
}

export const getContainerName = (container: string | Container): string => {
    return Object.entries(Container).find(([, val]) => val === container)?.[0]!
}

export class Kubernetes {
    private readonly k8sConfig: KubeConfig
    private readonly k8sApi: k8s.CoreV1Api

    constructor() {
        this.k8sConfig = new k8s.KubeConfig()

        if (config.nodeENV === 'production') {
            this.k8sConfig.loadFromCluster()
        } else {
            this.k8sConfig.loadFromDefault()
        }

        this.k8sApi = this.k8sConfig.makeApiClient(k8s.CoreV1Api)
    }

    async setupRestartMonitoring(schedule: string) {
        if (config.nodeENV !== 'production') return

        new Cron(schedule, async () => {
            const pods = await this.getPods('chainflip')
            await Promise.all(_.map(pods, (pod) => {
                return this.monitorRestarts(pod)
            }))
        }).run()
    }

    private async monitorRestarts(pod: K8sPod) {
        await log.info(`${Kubernetes.name}:${getContainerName(pod.container)}:Pod:Restarts: ${pod.restarts}`)

        // Alert for any restarts
        if (pod.restarts > 0) {
            await global.betterStack?.createRestartIncident(getContainerName(pod.container), pod.restarts)
        } else {
            await global.betterStack?.resolveIncidents(getContainerName(pod.container), IncidentType.RESTART)
        }
    }

    private async getPods(namespace: string): Promise<Array<K8sPod>> {
        const response = await this.k8sApi.listNamespacedPod(namespace)

        return _.map(response.body.items, (pod) => {
            return {
                name: pod.metadata!.name!,
                namespace: namespace,
                container: pod.metadata!.labels!['app.kubernetes.io/name'] as Container,
                restarts: _.reduce(_.map(pod.status!.containerStatuses!, (status) => {
                    return status.restartCount
                }), (a, b) => {
                    return a + b
                }) ?? 0
            }
        })
    }
}
