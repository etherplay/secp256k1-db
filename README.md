# secp256k1-db

An authenticated key-value database using secp256k1 signatures (compatible with Ethereum wallets).

## Overview

This service allows storing and retrieving data associated with Ethereum addresses, where only the owner of the private key can modify their data. All write operations require a valid signature from the address owner, ensuring data integrity and authentication.

Key features:
- Read/write/delete string values associated with Ethereum addresses
- Namespace support for organizing data
- Counter-based versioning to prevent data overwrites
- JSONRPC API with CORS support
- Designed for Cloudflare Workers with KV storage

## Installation

```bash
# Clone the repository
git clone https://github.com/etherplay/secp256k1-db.git
cd secp256k1-db

pnpm install
```

## Development

To start the development server:

```bash
pnpm start
```

This will start a local Cloudflare Workers development server.

## Deployment

To deploy to Cloudflare Workers:

```bash
pnpm run deploy
```

## API Methods

### `wallet_getString`

Retrieves data associated with an Ethereum address in a specific namespace.

Parameters:
- `address`: Ethereum address (0x-prefixed)
- `namespace`: String namespace

Example:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "wallet_getString",
  "params": ["0x1234567890123456789012345678901234567890", "my-namespace"]
}
```

### `wallet_putString`

Stores data associated with an Ethereum address in a specific namespace. Requires a valid signature.

Parameters:
- `address`: Ethereum address (0x-prefixed)
- `namespace`: String namespace
- `counter`: Counter value (typically current timestamp in ms)
- `data`: String data to store
- `signature`: Signed message of `put:${namespace}:${counter}:${data}`

Example:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "wallet_putString",
  "params": [
    "0x1234567890123456789012345678901234567890",
    "my-namespace",
    "1632146788123",
    "Hello, world!",
    "0x123...signature"
  ]
}
```

## Configuration

In `wrangler.toml`:
- Set up your KV namespace bindings
- Configure your Cloudflare Worker name and compatibility date

## License

See the [LICENSE](LICENSE) file for details.

