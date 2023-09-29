# Flipr 🐬

A monitoring application for Chainflip nodes.

## Features

- All chains are monitored for `Health` and `Sync Status` every minute
- Chainflip node version is monitored every minute
- Kubernetes pod restarts are monitored every minute
- Kubernetes pod logs of all chains are aggregated
- Reputation is monitored every minute
- Penalties are monitored every minute
- Chain observations are monitored every minute

## Supported Chains

| Client   | Chain                            |
|----------|----------------------------------|
| Bitcoin  | Bitcoin (BTC)                    |
| Ethereum | Ethereum (ETH)                   |
| Polkadot | Polkadot (DOT), Chainflip (FLIP) |

## Environment Variables

| Key                     | Required | Description                                                                                                      |
|-------------------------|----------|------------------------------------------------------------------------------------------------------------------|
| NODE_ENV                | No       | Set to `production`, if you want to run the application in production.                                           |
| BETTERSTACK_API_KEY     | No       | BetterStack API key, see [here](#betterstack-optional).                                                          |
| LOGS_SOURCE_TOKEN       | No       | BetterStack Logs source token, see [here](#logs-optional).                                                       |
| CHAINFLIP_NODE_ADDRESS  | Yes      | Public SS58 address of your Chainflip node (`cF...`).                                                            |
| NODE_ENDPOINT_CHAINFLIP | Yes      | Chainflip node endpoint (e.g. http://chainflip.chainflip:9944).                                                  |
| NODE_ENDPOINT_BITCOIN   | Yes      | Bitcoin node endpoint (e.g. [http://flip:flip@bitcoin.chainflip:8332](http://flip:flip@bitcoin.chainflip:8332)). |
| NODE_ENDPOINT_ETHEREUM  | Yes      | Ethereum node endpoint (e.g. http://ethereum.chainflip:8545).                                                    |
| NODE_ENDPOINT_POLKADOT  | Yes      | Polkadot node endpoint (e.g. http://polkadot.chainflip:9944).                                                    |

## Kubernetes

### Deployment

#### Add to Cluster

Set all environment variables in `k8s-deployment.yaml` and deploy the application:

```
kubectl create -f k8s-deployment.yaml
```

#### Remove from Cluster

Remove the application from the Kubernetes cluster:

```
kubectl delete -f k8s-deployment.yaml
```

### Prometheus Metrics Server

You can access all metrics via the `/metrics` endpoint. To scrape these metrics with your Prometheus instance, add the following job to your `prometheus.yaml` configuration:

```yaml
scrape_configs:
  - job_name: 'flipr'
    static_configs:
      - targets: ['flipr.chainflip']
```

## Systemd Service

### Prerequisites

- `node` (v16.17): Install it via [NVM](https://github.com/nvm-sh/nvm)
- `yarn`: Install it via `npm install -g yarn`

### Build

Clone this repository to your machine and run:

```shell
cd flipr
yarn install
yarn build
```

#### Create a systemd Service File

Open a new service file in an editor with root permissions:

```shell
sudo vi /etc/systemd/system/flipr.service
```

Copy and paste the following content:

```unit file (systemd)
[Unit]
Description=Flipr

[Service]
Restart=always
RestartSec=10

Environment="NODE_ENV=production"
Environment="BETTERSTACK_API_KEY=XXX"
Environment="LOGS_SOURCE_TOKEN=XXX"
Environment="CHAINFLIP_NODE_ADDRESS=XXX"
Environment="NODE_ENDPOINT_CHAINFLIP=XXX"
Environment="NODE_ENDPOINT_BITCOIN=XXX"
Environment="NODE_ENDPOINT_ETHEREUM=XXX"
Environment="NODE_ENDPOINT_POLKADOT=XXX"

ExecStart={NODE_INSTALLATION_PATH} {DIRECTORY_PATH}/dist/main.js

[Install]
WantedBy=multi-user.target
```

Set all required environment variables and replace:

- `NODE_INSTALLATION_PATH`: Path to your `node` binary
- `DIRECTORY_PATH`: Path to the this project directory

#### Set Environment Variables

Replace the environment variables with your environment variables.

#### Reload systemd

After creating the service file, inform systemd of the new service:

```shell
sudo systemctl daemon-reload
```

#### Enable and Start the Service

To make sure the service starts on boot:

```shell
sudo systemctl enable flipr
```

#### Start the service with

```shell
sudo systemctl start flipr
```

#### Checking the Service Status

You can check the status of your service at any time with:

```shell
sudo systemctl status flipr
```

#### Logs

If you want to monitor the application logs:

```shell
sudo journalctl -f -u flipr
```

This will show real-time logs of the flipr service.

#### Stopping and Restarting

If you need to stop or restart the service:

```
sudo systemctl stop flipr
sudo systemctl restart flipr
```

## Local Environment

### Installation

Install all the required dependencies from `package.json`:

```
yarn install
```

### Build

Compile `.ts` to `.js`:

```
yarn build
```

### Run

Run via `node.js`:

```
yarn start
```

## BetterStack (optional)

### Uptime

BetterStack Uptime is used for alerting and incident management.

- Heartbeats are sent every minute for `Health` and `Sync Status` of the nodes
- Missed heartbeats create incidents
- Kubernetes pod restarts create incidents
- Low reputation create incidents
- Penalties create incidents
- Outdated Chainflip node versions creates incidents

#### API Key

Sign up at [betterstack.com](https://uptime.betterstack.com/?ref=8l7f) and follow the [docs](https://betterstack.com/docs/uptime/api/getting-started-with-uptime-api/) to get the API key.

### Logs (optional)

BetterStack Logs is used for log manangement and dashboard visualization.

- Flipr forwards its own logs
- k8s `error` and `warn` logs are also forwarded

#### Source Token

Sign up at [betterstack.com](https://logs.betterstack.com/?ref=8l7f) and follow the [docs](https://betterstack.com/docs/logs/logging-start/) to get a source token for the platform `JavaScript • Node.js`.

## License

```
MIT License

Copyright (c) 2023 Sour Capital Pte. Ltd.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
