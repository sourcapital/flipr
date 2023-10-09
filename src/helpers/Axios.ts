import axios, {AxiosResponse} from 'axios'

axios.interceptors.response.use(
    (response) => {
        return response
    },
    async (error) => {
        if (error.response) {
            await log.error(`Error (${error.response.status}) occurred for ${error.response.config.method.toUpperCase()} request: ${error.config.url}`)
        } else {
            await log.error(`Error: ${error.message}`)
        }
        return Promise.reject(error)
    }
)

export const safeAxiosGet = async (url: string): Promise<AxiosResponse | undefined> => {
    try {
        return await axios.get(url)
    } catch (error) {
        return undefined
    }
}

export const safeAxiosPost = async (url: string, data: {}, config: {}): Promise<AxiosResponse | undefined> => {
    try {
        return await axios.post(url, data, config)
    } catch (error) {
        return undefined
    }
}
