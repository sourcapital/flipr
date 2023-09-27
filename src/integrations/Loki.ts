import WebSocket from 'ws'
import moment from 'moment'
import {config} from '../config.js'
import {handleError} from '../helpers/Error.js'
import {getContainerName} from './Kubernetes.js'

export class Loki {
    private ws?: WebSocket
    private retries = 3

    async connect() {
        if (config.nodeENV !== 'production') return

        await log.debug(`${Loki.name}: Connecting ...`)

        const host = config.nodeENV === 'production' ? 'loki.loki-system' : 'localhost'
        const nowTsNs = moment().unix() * 1e9 // Timestamp in nano seconds
        this.ws = new WebSocket(`ws://${host}:3100/loki/api/v1/tail?query={namespace="chainflip"}&start=${nowTsNs}`)

        this.ws.on('open', async () => {
            await log.debug(`${Loki.name}: WebSocket connected!`)
            this.retries = 3
        })

        this.ws.on('close', async () => {
            await log.debug(`${Loki.name}: WebSocket disconnected!`)
            this.retries -= 1

            if (this.retries > 0) {
                await log.debug(`${Loki.name}: Reconnecting ...`)
                await sleep(1000)
                await this.connect()
            }
        })

        this.ws.on('error', async (error: any) => {
            if (error.code === 'ECONNREFUSED') {
                console.error(`${Loki.name}: Unable to connect to '${host}'. Connection was refused!`)
            } else {
                await handleError(error)
            }
        })

        this.ws.on('message', async (data) => {
            try {
                const streams: Array<any> = JSON.parse(data.toString()).streams
                for (const stream of streams) {
                    let message = stream.values[0][1]

                    try {
                        // Check if message is a json
                        JSON.parse(message)
                        // Stringify the message
                        message = JSON.stringify(message)
                    } catch {
                        // Message is not a json, do nothing
                    }

                    // Prettify and trim
                    message = message
                        .replaceAll(/\s+/g, ' ')
                        .replaceAll('\n', '')
                        .replaceAll('\\"', "'")
                        .replaceAll('"', '')
                        .trim()

                    const logLevel = await this.parseLogLevel(message)
                    const prefix = `${Loki.name}:${getContainerName(stream.stream.app)}`

                    switch (logLevel) {
                        case 'debug':
                            // Do not forward debug logs
                            // await log.debug(`${prefix}: ${message}`, false)
                            break
                        case 'info':
                            // Do not forward info logs
                            // await log.info(`${prefix}: ${message}`, false)
                            break
                        case 'warn':
                            await log.warn(`${prefix}: ${message}`, false)
                            break
                        case 'error':
                            await log.error(`${prefix}: ${message}`, false)
                            break
                    }
                }
            } catch (error) {
                await handleError(error)
            }
        })
    }

    private async parseLogLevel(message: string): Promise<string> {
        message = message.toLowerCase()

        const regex1 = /(debug|info|warn|error)/g.exec(message)
        const regex2 = /([diwe])[a-z]*\s*\[/.exec(message)

        let logLevel: string
        if (regex1) {
            logLevel = regex1.slice(1, 2)[0]
        } else if (regex2) {
            logLevel = regex2.slice(1, 2)[0]
        } else {
            logLevel = 'none'
        }

        switch (logLevel) {
            case 'd':
            case 'debug':
                logLevel = 'debug'
                break
            case 'i':
            case 'info':
                logLevel = 'info'
                break
            case 'w':
            case 'warn':
            case 'warning':
                logLevel = 'warn'
                break
            case 'e':
            case 'error':
                logLevel = 'error'
                break
            default:
                logLevel = 'info'
                break
        }

        return logLevel
    }
}
