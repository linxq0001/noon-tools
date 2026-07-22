# noon Partners API 文档整理

来源：<https://noon-docs.noonpartners.dev/>。按官方 API Reference 模块整理，共 56 个端点。

Base URL：`https://api.noon.partners`

说明：官方 API Reference 页面中的端点以相对路径展示，例如 `/v1/whoami`。本文档后续 curl 示例里的 `https://<base-url>` 对应 `https://api.noon.partners`。

通用说明：多数端点需要先通过 API JWT 或 OAuth 建立认证；文档中的大部分端点默认 usage plan 为 Rate/Burst `1500 requests / 60 seconds`，实际限制以官方页面为准。


## AUTH / Authentication

### APILogin

- 方法：`POST /public/v1/api/login`

- 用途：Authenticates a service account using an API JWT token. The token is decoded to identify the service account, and a session is created upon successful authentication. Session cookies are set in the response for subsequent authenticated requests. Optionally, a default project code can be provided to scope the session.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/authentication/auth-service-api-login>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/public/v1/api/login' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `token` | string | 是 | The API JWT token used to authenticate the service account. |
| `default_project_code` | string | 否 | Optional project code to set as the default project for the session. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `(body)` | object | 否 | - |

### Whoami

- 方法：`GET /v1/whoami`

- 用途：Returns the user code and username of the currently authenticated user based on the active session.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/authentication/auth-service-whoami>

- 使用方法：

```bash
curl -X GET 'https://<base-url>/v1/whoami' \
  -H 'Authorization: Bearer <token>'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

_无明确参数。_

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `user_code` | string | 是 | Unique identifier for the authenticated user. |
| `username` | string | 是 | Username of the authenticated user. |


## AUTH / OAuth

### CreateToken

- 方法：`POST /v1/token/create`

- 用途：Exchanges an authorization code for an OAuth access token. Provide the authorization code received from the OAuth consent flow along with your client credentials (client_id and client_secret). On success, returns a JWT access token, its expiry duration, granted scopes, and the seller's authorized project code.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/oauth/o-auth-service-create-token>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/token/create' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `grant_type` | string | 是 | The OAuth grant type. Use 'authorization_code' for standard OAuth code exchange. |
| `code` | string | 是 | The authorization code received from the OAuth consent redirect. |
| `client_id` | string | 是 | Your OAuth client ID issued during app registration. |
| `client_secret` | string | 是 | Your OAuth client secret issued during app registration. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `access_token` | string | 是 | The JWT token to use for token exchange. |
| `token_type` | string enum | 是 | The type of token issued (Bearer). |
| `expires_in` | string | 是 | Duration until the token expires. |
| `scopes` | array<string> | 是 | List of scopes granted to the token. |
| `project_code` | string | 是 | The seller's authorized project code associated with this token. |

### ExchangeToken

- 方法：`POST /v1/token/exchange`

- 用途：Completes the OAuth exchange by executing the associated workflow. Provide the JWT access token obtained from CreateToken. The workflow is triggered on the seller's behalf, and the response includes the execution status, the seller's project code, a unique OAuth request ID for tracking, and the workflow result containing the protected resource (e.g. issued credentials). Refer to the integration guide for your specific workflow to see the expected result schema.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/oauth/o-auth-service-exchange-token>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/token/exchange' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `access_token` | string | 是 | The JWT token obtained from the CreateToken response. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `status` | object | 是 | The `Status` type defines a logical error model that is suitable for different programming environments, including REST APIs and RPC APIs. It is used by [gRPC](https://github.com/grpc). Each `Status` message contains three pieces of data: error code, error message, and error details. You can find out more about this error model and how to work with it in the [API Design Guide](https://cloud.google.com/apis/design/errors). |
| `status.status_id` | integer(int32) | 否 | - |
| `status.status_code` | string | 否 | - |
| `status.message` | string | 否 | - |
| `status.details` | array<object> | 否 | - |
| `project_code` | string | 是 | The seller's project code associated with this OAuth exchange. |
| `oauth_request_id` | string | 是 | Unique identifier for this OAuth exchange request, used for tracking. |
| `result` | object | 否 | Workflow result containing the protected resource (e.g. issued credentials). The schema varies by the workflow configured for the client configured on the OAuth client — refer to the relevant integration guide for expected fields. Struct is used here because each workflow returns a different resource type; optional because result is only present when the workflow completes successfully and synchronously. The top-level value is always a JSON object. |
| `result` | object | 否 | Workflow result containing the protected resource (e.g. issued credentials). The schema varies by the workflow configured for the client configured on the OAuth client — refer to the relevant integration guide for expected fields. Struct is used here because each workflow returns a different resource type; optional because result is only present when the workflow completes successfully and synchronously. The top-level value is always a JSON object. |


## AUTH / API User

### CreateCredential

- 方法：`POST /v1/credential/create`

- 用途：Generates a new APIJWT credential (RSA key pair) for an API service account. The returned private key is only available in this response — it is not stored server-side. Optionally restrict the credential to specific IP addresses and set an expiry. Caller must provide at least one of user_code or channel_identifier. Empty strings are invalid. If both are provided, user_code wins.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/apiuser/api-user-service-create-credential>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/credential/create' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `user_code` | string | 否 | The API user's user_code. When set, it must be non-empty. If omitted, channel_identifier must be provided and will be used to resolve the user_code server-side. |
| `whitelisted_ips` | array<string> | 是 | Optional list of IP addresses to restrict this credential to (max 10 IPs). |
| `expires_at` | string | 否 | Optional expiry in ISO 8601 format (e.g. "2026-12-31T23:59:59+00:00"). |
| `channel_identifier` | string | 否 | The service account's channel identifier (username). When set, it must be non-empty. Used to resolve the user_code when the caller does not have it. Ignored if user_code is set. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `credential` | object | 是 | The generated credential with private key material. |
| `credential.key_id` | string | 是 | Unique key identifier (used as the JWT 'sub' claim when authenticating). |
| `credential.private_key` | string | 是 | PEM-encoded RSA private key. |
| `credential.channel_identifier` | string | 是 | The service account's email/username. |
| `credential.project_code` | string | 是 | The project code this credential is scoped to. |
| `credential.type` | string | 是 | Channel type (always "apijwt"). |
| `credential.issued_at` | string | 是 | ISO 8601 timestamp of when the credential was issued. |

### RemoveCredentials

- 方法：`POST /v1/credential/remove`

- 用途：Deactivates APIJWT credentials for an API service account. If a key_id is provided, only that specific credential is removed. If no key_id is provided, all active credentials for the user are removed. Caller must provide at least one of user_code or channel_identifier. Empty strings are invalid. If both are provided, user_code wins.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/apiuser/api-user-service-remove-credentials>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/credential/remove' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `user_code` | string | 否 | The API user's user_code. When set, it must be non-empty. If omitted, channel_identifier must be provided and will be used to resolve the user_code server-side. |
| `key_id` | string | 否 | Optional: the specific key_id to deactivate. If omitted, all active credentials are removed. |
| `channel_identifier` | string | 否 | The service account's channel identifier (username). When set, it must be non-empty. Used to resolve the user_code when the caller does not have it. Ignored if user_code is set. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | boolean | 是 | Whether the operation completed successfully. |
| `credentials_removed` | integer(int32) | 是 | Number of credentials that were deactivated. |


## CATALOG / Global Product & Pricing

### BatchGetTransferPrice

- 方法：`POST /v1/transfer-price/get`

- 用途：Get the transfer price for a product

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/xborder-pricing/xborder-pricing-service-batch-get-transfer-price>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/transfer-price/get' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | Array of transfer price lookup items. Max 1000 items per request. |
| `items[].partner_sku` | string | 是 | Partner SKU for that item. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | Array of items for which transfer price info was asked. Max 1000 items per response (matches request cap). |
| `items[].partner_sku` | string | 是 | Partner SKU for that item. |
| `items[].status` | object | 是 | The `Status` type defines a logical error model that is suitable for different programming environments, including REST APIs and RPC APIs. It is used by [gRPC](https://github.com/grpc). Each `Status` message contains three pieces of data: error code, error message, and error details. You can find out more about this error model and how to work with it in the [API Design Guide](https://cloud.google.com/apis/design/errors). |
| `items[].status.status_id` | integer(int32) | 否 | - |
| `items[].status.status_code` | string | 否 | - |
| `items[].status.message` | string | 否 | - |
| `items[].status.details` | array<object> | 否 | - |
| `items[].transfer_price_usd` | number(double) | 否 | Transfer price of the partner SKU in USD currency. |
| `items[].msrp_usd` | number(double) | 否 | MSRP in USD currency of the partner SKU. |
| `items[].is_active` | boolean | 否 | The pricing status of the item (Active or Inactive). |

### BatchUpsertProduct

- 方法：`POST /v1/product/upsert`

- 用途：Create a new product or update an existing one

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/xborder-pricing/xborder-pricing-service-batch-upsert-product>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/product/upsert' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | Array of items needed to be created or updated. |
| `items[].partner_sku` | string | 是 | Partner SKU for that item. |
| `items[].dimensions_cm` | object | 否 | Dimensions (length, width, height) of that item in centimeters. |
| `items[].dimensions_cm.length` | number(double) | 是 | Length of the item in centimeters. |
| `items[].dimensions_cm.width` | number(double) | 是 | Width of the item in centimeters. |
| `items[].dimensions_cm.height` | number(double) | 是 | Height of the item in centimeters. |
| `items[].vm_weight_cm` | number(double) | 否 | Volumetric weight of that item in centimeters. |
| `items[].actual_weight_kg` | number(double) | 否 | Actual weight of that item in kilograms. |
| `items[].hs_code` | string | 否 | Harmonized system (HS) code for that item. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | Array of items created or updated in the request. |
| `items[].partner_sku` | string | 是 | Partner SKU for that item. |
| `items[].status` | object | 是 | Status indicating whether the update executed successfully or encountered an error. |
| `items[].status.status_id` | integer(int32) | 否 | - |
| `items[].status.status_code` | string | 否 | - |
| `items[].status.message` | string | 否 | - |
| `items[].status.details` | array<object> | 否 | - |

### BatchUpsertTransferPrice

- 方法：`POST /v1/transfer-price/upsert`

- 用途：Set the transfer price for a product

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/xborder-pricing/xborder-pricing-service-batch-upsert-transfer-price>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/transfer-price/upsert' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | Array of transfer prices needed to be set or updated. |
| `items[].partner_sku` | string | 是 | Partner SKU for that item. |
| `items[].transfer_price_usd` | number(double) | 否 | Transfer price to be set or updated in USD currency for that item. |
| `items[].msrp_usd` | number(double) | 否 | MSRP needed to be set or updated for that item. |
| `items[].is_active` | boolean | 否 | The pricing status of the item (Active or Inactive). |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | Array of items for which pricing will be set. |
| `items[].partner_sku` | string | 是 | Partner SKU for that item. |
| `items[].status` | object | 是 | The `Status` type defines a logical error model that is suitable for different programming environments, including REST APIs and RPC APIs. It is used by [gRPC](https://github.com/grpc). Each `Status` message contains three pieces of data: error code, error message, and error details. You can find out more about this error model and how to work with it in the [API Design Guide](https://cloud.google.com/apis/design/errors). |
| `items[].status.status_id` | integer(int32) | 否 | - |
| `items[].status.status_code` | string | 否 | - |
| `items[].status.message` | string | 否 | - |
| `items[].status.details` | array<object> | 否 | - |


## CATALOG / Pricing

### BatchGetPricing

- 方法：`POST /v1/pricing/get`

- 用途：Returns pricing data for the given partner SKUs

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/pricing/pricing-service-batch-get-pricing>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/pricing/get' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | - |
| `items[].partner_sku` | string | 是 | The unique identifier for the item in the partner's system. |
| `items[].country_code` | string | 是 | Country code for which price is being set. Should be one of these string values: "ae","sa","eg" |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | - |
| `items[].partner_sku` | string | 是 | - |
| `items[].country_code` | string | 是 | - |
| `items[].status` | object | 是 | The `Status` type defines a logical error model that is suitable for different programming environments, including REST APIs and RPC APIs. It is used by [gRPC](https://github.com/grpc). Each `Status` message contains three pieces of data: error code, error message, and error details. You can find out more about this error model and how to work with it in the [API Design Guide](https://cloud.google.com/apis/design/errors). |
| `items[].status.status_id` | integer(int32) | 否 | - |
| `items[].status.status_code` | string | 否 | - |
| `items[].status.message` | string | 否 | - |
| `items[].status.details` | array<object> | 否 | - |
| `items[].price` | number(double) | 否 | - |
| `items[].msrp` | number(double) | 否 | - |
| `items[].is_active` | boolean | 否 | - |

### BatchUpsertPricing

- 方法：`POST /v1/pricing/upsert`

- 用途：Creates or updates pricing data for the given partner SKUs

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/pricing/pricing-service-batch-upsert-pricing>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/pricing/upsert' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | - |
| `items[].partner_sku` | string | 是 | The unique identifier for the item in the partner's system. |
| `items[].country_code` | string | 是 | Country code for which price is being set. Should be one of these string values: "ae","sa","eg" |
| `items[].price` | number(double) | 否 | The price of the item to be updated. |
| `items[].msrp` | number(double) | 否 | The crossed-out price shown on the listing page |
| `items[].is_active` | boolean | 否 | If False item will not be sold on the platform |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | - |
| `items[].partner_sku` | string | 是 | - |
| `items[].country_code` | string | 是 | - |
| `items[].status` | object | 是 | The `Status` type defines a logical error model that is suitable for different programming environments, including REST APIs and RPC APIs. It is used by [gRPC](https://github.com/grpc). Each `Status` message contains three pieces of data: error code, error message, and error details. You can find out more about this error model and how to work with it in the [API Design Guide](https://cloud.google.com/apis/design/errors). |
| `items[].status.status_id` | integer(int32) | 否 | - |
| `items[].status.status_code` | string | 否 | - |
| `items[].status.message` | string | 否 | - |
| `items[].status.details` | array<object> | 否 | - |


## CATALOG / Stock

### GetStock

- 方法：`POST /v1/stock-list`

- 用途：Given a list of warehouse and partner_sku pairs return the quantity for each respective pair

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/stock/stock-service-get-stock>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/stock-list' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | List of (warehouse_code, partner_sku) pairs to retrieve thier stock information |
| `items[].warehouse_code` | string | 是 | Integration warehouse code to retrieve stock for |
| `items[].partner_sku` | string | 是 | Partner sku to retrive its stock information in that warehouse |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | List of retrieved stock information |
| `items[].warehouse_code` | string | 是 | Warehouse code of the item |
| `items[].partner_sku` | string | 是 | Partner sku of the item |
| `items[].status` | object | 是 | Status indicating whether the workflow executed successfully or encountered an error. |
| `items[].status.status_id` | integer(int32) | 否 | - |
| `items[].status.status_code` | string | 否 | - |
| `items[].status.message` | string | 否 | - |
| `items[].status.details` | array<object> | 否 | - |
| `items[].qty` | integer(int32) | 是 | Existing stock for the partner sku in the warehouse (this is the total stock that the partner updated for noon) |
| `items[].processing_time` | string | 否 | processing_time of the item |
| `items[].stock_updated_at` | string(date-time) | 否 | Last time the stock was updated |

### UpdateStock

- 方法：`POST /v1/stock-update`

- 用途：Update the stock in the warehouse

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/stock/stock-service-update-stock>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/stock-update' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | List of the wanted (warehouse code, partner sku) to update respective qty and processing time |
| `items[].warehouse_code` | string | 是 | Warehouse code of the item to update stock for |
| `items[].partner_sku` | string | 是 | Partner sku of the item to update stock for |
| `items[].qty` | integer(int32) | 否 | Represents available stock to be updates (update stock to be 4 for example) |
| `items[].processing_time` | string | 否 | Processing time of the item if needs to be updated |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | Returns list of status for each item, if it was updated successfully or failed |
| `items[].warehouse_code` | string | 是 | Warehouse code of item that was requested for update |
| `items[].partner_sku` | string | 是 | Partner sku of item that was requested for update |
| `items[].status` | object | 是 | The `Status` type defines a logical error model that is suitable for different programming environments, including REST APIs and RPC APIs. It is used by [gRPC](https://github.com/grpc). Each `Status` message contains three pieces of data: error code, error message, and error details. You can find out more about this error model and how to work with it in the [API Design Guide](https://cloud.google.com/apis/design/errors). |
| `items[].status.status_id` | integer(int32) | 否 | - |
| `items[].status.status_code` | string | 否 | - |
| `items[].status.message` | string | 否 | - |
| `items[].status.details` | array<object> | 否 | - |


## CATALOG / Catalog

### ChildSkuDelete

- 方法：`POST /v1/sku/child/delete`

- 用途：This API allows partners to delete Partner SKUs/Child ZSKUs.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/catalog/catplat-service-child-sku-delete>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/sku/child/delete' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | list of partner skus or zsku childs to delete |
| `items[].partner_sku` | string | 是 | Unique identifier for the variant SKU or sellable SKU. |
| `items[].zsku_child` | string | 是 | A unique indentifier created by Noon against the partner SKU. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | list of partner skus |
| `items[].partner_sku` | string | 是 | Unique identifier for the variant SKU or sellable SKU. |
| `items[].zsku_child` | string | 是 | A unique indentifier created by Noon against the partner SKU. |
| `items[].status` | object | 是 | The `Status` type defines a logical error model that is suitable for different programming environments, including REST APIs and RPC APIs. It is used by [gRPC](https://github.com/grpc). Each `Status` message contains three pieces of data: error code, error message, and error details. You can find out more about this error model and how to work with it in the [API Design Guide](https://cloud.google.com/apis/design/errors). |
| `items[].status.status_id` | integer(int32) | 否 | - |
| `items[].status.status_code` | string | 否 | - |
| `items[].status.message` | string | 否 | - |
| `items[].status.details` | array<object> | 否 | - |

### CreateBarcodeImport

- 方法：`POST /v1/import/barcode`

- 用途：Create barcode import using a File, BigQuery table, or inline items. Requirements: - Must provide exactly one source: file_url, bq_table, or items.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/catalog/catplat-service-create-barcode-import>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/import/barcode' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `file_url` | string | 是 | HTTP/HTTPS or GCS path for file imports (Supports CSV, TSV, XLSX, JSON, Parquet). |
| `bq_table` | string | 是 | BigQuery table reference for the data. |
| `items` | object | 是 | List of barcode items inserted inline. |
| `items.data` | array<object> | 是 | List of barcode mapping items provided inline in the request. Expected maximum: 10,000 items. |
| `items.data[].partner_sku` | string | 是 | A unique user-defined product code/stock keeping unit (SKU) which already exists in the catalog. |
| `items.data[].barcode` | string | 是 | The barcode, UPC, or ISBN number for the product. |
| `items.data[].force_sync` | boolean | 是 | Bool value to force sync mappings and override any existing mapping between same "barcode" and partner_sku. |
| `config` | object | 是 | Configuration for the import behavior. |
| `config.is_notification_required` | boolean | 是 | Set the value to trigger a WHIP notification upon completion. Its optional default value is false. |
| `config.force_sync` | boolean | 是 | Set the value to forcefully synchronize/overwrite existing mappings for the overall request. Its optional default value is false. |
| `client_reference` | string | 是 | A unique user-defined client_reference. max_chars=100 Must be unique. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `import_reference` | string | 是 | Unique reference ID for checking status/reports of this import operation. |
| `client_reference` | string | 是 | User-defined client reference |

### GenerateImportSignedUrl

- 方法：`POST /v1/import/generate-import-signed-url`

- 用途：Generate a Signed URL for direct file upload to a GCS bucket. Supported file types: csv, tsv, json, xlsx, xlsm, parquet.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/catalog/catplat-service-generate-import-signed-url>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/import/generate-import-signed-url' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `file_type` | string enum | 是 | The type of file to be uploaded. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `url` | string | 是 | The generated signed URL for the upload. |
| `fields` | object | 是 | Additional form fields required when uploading via a signed POST URL. Currently populated because only POST-based signed uploads are supported. Contains standard GCS V4 policy fields such as 'key', 'policy', 'x-goog-signature', etc. |
| `fields` | object | 否 | Additional form fields required when uploading via a signed POST URL. Currently populated because only POST-based signed uploads are supported. Contains standard GCS V4 policy fields such as 'key', 'policy', 'x-goog-signature', etc. |
| `identifier` | string | 是 | Unique identifier for the file once uploaded. |

### GetImportStatus

- 方法：`GET /v1/import/status/{reference}`

- 用途：Retrieve the current status and processing report of an import. Provides metrics on success/failure counts, current progress, and completion timestamps.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/catalog/catplat-service-get-import-status>

- 使用方法：

```bash
curl -X GET 'https://<base-url>/v1/import/status/{reference}' \
  -H 'Authorization: Bearer <token>'
```

**路径/查询/Header 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `reference` | string | 是 | path。Can be either system-generated import_reference or user-defined client_reference. |

**请求 Body 参数**

_无明确参数。_

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `import_type` | string | 是 | Type of import (e.g., "barcode", "SKU Backfill", "SKU Grouping"). |
| `import_reference` | string | 是 | Unique reference ID of the barcode import batch. |
| `client_reference` | string | 是 | User-defined client reference. |
| `created_by` | string | 是 | The email or username of the user who triggered the import. |
| `config` | object | 是 | Configuration for the import behavior. |
| `config.is_notification_required` | boolean | 是 | Set the value to trigger a WHIP notification upon completion. Its optional default value is false. |
| `config.force_sync` | boolean | 是 | Set the value to forcefully synchronize/overwrite existing mappings for the overall request. Its optional default value is false. |
| `file_url` | string | 是 | Original storage path where the file was stored. |
| `bq_table` | string | 是 | BigQuery table reference. |
| `report` | object | 是 | Processing report dictionary covering success/failed counts and duration metrics. |
| `report` | object | 否 | Processing report dictionary covering success/failed counts and duration metrics. |
| `import_status` | string enum | 是 | Current operation status. |
| `sub_status` | string | 是 | Sub status for detailed tracking. |
| `created_at` | string(date-time) | 是 | Creation timestamp. |
| `updated_at` | string(date-time) | 是 | Timestamp of the latest status/sub_status change. |
| `completed_at` | string(date-time) | 是 | Timestamp pinpointing the end-time validation and completion. |

### ParentSkuDelete

- 方法：`POST /v1/sku/parent/delete`

- 用途：This API enables partners to delete Parent Partner SKUs/ZSKU Parents; performing this action triggers a cascading deletion of all associated Child SKUs.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/catalog/catplat-service-parent-sku-delete>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/sku/parent/delete' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | list of parent partner skus or zsku parents to delete |
| `items[].parent_partner_sku` | string | 是 | A Parent Partner SKU represents the base product and is not a sellable item; it is used to organize product variations under a single listing. |
| `items[].zsku_parent` | string | 是 | A unique indentifier created by Noon against the parent partner SKU. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | - |
| `items[].parent_partner_sku` | string | 否 | A Parent Partner SKU represents the base product and is not a sellable item; it is used to organize product variations under a single listing. |
| `items[].zsku_parent` | string | 是 | A unique indentifier created by Noon against the parent partner SKU. |
| `items[].variants` | array<object> | 是 | list of variants deleted |
| `items[].variants[].partner_sku` | string | 是 | Unique identifier for the variant SKU or sellable SKU. |
| `items[].variants[].zsku_child` | string | 是 | A unique indentifier created by Noon against the partner SKU. |
| `items[].status` | object | 是 | The `Status` type defines a logical error model that is suitable for different programming environments, including REST APIs and RPC APIs. It is used by [gRPC](https://github.com/grpc). Each `Status` message contains three pieces of data: error code, error message, and error details. You can find out more about this error model and how to work with it in the [API Design Guide](https://cloud.google.com/apis/design/errors). |
| `items[].status.status_id` | integer(int32) | 否 | - |
| `items[].status.status_code` | string | 否 | - |
| `items[].status.message` | string | 否 | - |
| `items[].status.details` | array<object> | 否 | - |

### catplat-service-sku-barcode-map

- 方法：`POST /v1/barcode/map`

- 用途：官方文档未提供详细描述。

- 官方页面：<https://noon-docs.noonpartners.dev/docs/>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/barcode/map' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

_无明确参数。_

**成功返回参数**

_无明确参数。_


## CATALOG / Offer

### GetProductOffers

- 方法：`GET /v1/product/{partner_sku}`

- 用途：Retrieves offer details for a given partner SKU across all countries.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/offer/offer-service-get-product-offers>

- 使用方法：

```bash
curl -X GET 'https://<base-url>/v1/product/{partner_sku}' \
  -H 'Authorization: Bearer <token>'
```

**路径/查询/Header 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `partner_sku` | string | 是 | path。Your internal unique identifier for the product. |

**请求 Body 参数**

_无明确参数。_

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `partner_sku` | string | 是 | Partner provided SKU identifier. |
| `sku` | string | 是 | Noon SKU identifier. |
| `title` | string | 是 | Product title. |
| `brand` | string | 是 | Product brand name. |
| `offers` | array<object> | 是 | List of offers across different countries. |
| `offers[].offer_code` | string | 是 | Unique offer identifier. |
| `offers[].country_code` | string | 是 | The country in which the offer is available (e.g., ae, sa, eg). |
| `offers[].business_model` | string | 是 | The business model under which the offer is available (e.g., noon, supermall). |
| `offers[].price` | object | 否 | Current price of the offer. |
| `offers[].price.amount` | number(double) | 是 | Price amount. |
| `offers[].price.currency` | string | 是 | Currency code (e.g., AED, SAR, EGP). |
| `offers[].is_active` | boolean | 是 | Whether the product offer is active for this business model and country. |
| `offers[].active_net_stock` | integer(int32) | 是 | Available net stock for the offer. |
| `offers[].live_status` | boolean | 是 | Whether the offer is currently live on the storefront. |
| `offers[].offer_issues` | array<object> | 是 | List of issues due to which the offer is not live. |
| `offers[].offer_issues[].reason` | string | 是 | The issue reason. |
| `offers[].offer_issues[].subreason` | string | 是 | The issue sub-reason. |
| `offers[].offer_issues[].description` | string | 是 | Description of the issue. |


## CATALOG / Content

### GetContent

- 方法：`POST /v1/product/content/get`

- 用途：Retrieves content information for specified products.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/content/content-service-get-content>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/product/content/get' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `sku_parent` | string | 是 | sku_parent obtained from product upsert API |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `sku_parent` | string | 是 | sku_parent obtained for which the content information is provided |
| `attributes` | object | 是 | content stored for the product |
| `attributes` | object | 否 | content stored for the product |
| `images` | array<object> | 是 | images associated with the product along with their statuses |
| `images[].url` | string | 是 | provided URL of the image |
| `images[].sort` | integer(int64) | 是 | sorting order for the image gallery |
| `images[].visibility` | string enum | 是 | visibility status of the image (visible/hidden) |
| `images[].review_status` | string enum | 是 | validation status of the image after review (valid/invalid) |
| `images[].issues` | array<object> | 是 | issues found with the image, if image is invalid |
| `images[].issues[].code` | string | 是 | - |
| `images[].issues[].message` | string | 是 | - |
| `statuses` | array<object> | 是 | content status for different languages |
| `statuses[].language` | string enum | 是 | language code for which the status is provided |
| `statuses[].content` | object | 是 | content attributes status |
| `statuses[].content.completeness` | string | 是 | content completeness percentage (0-100) based on required attributes for the category |
| `statuses[].content.missing_attributes` | array<string> | 是 | required attributes that are missing for the product to be considered complete |
| `statuses[].content.invalid_attributes` | array<string> | 是 | required attributes that have invalid values |
| `statuses[].qc` | object | 是 | quality control status of the product |
| `statuses[].qc.status` | string enum | 是 | status of the product in the quality control process |
| `statuses[].qc.rejection_reasons` | array<string> | 是 | reasons for rejection, if the product was rejected |
| `statuses[].qc.comment` | string | 是 | comments from the quality control |
| `statuses[].overall_status` | string enum | 是 | overall status of the product (if product content is okay to go live) for the listing to be active, content_completeness must be 100% and QC must be approved |
| `statuses[].errors` | array<object> | 是 | any errors related to the product content which needs to be addressed to make the product active |
| `statuses[].errors[].code` | string | 是 | - |
| `statuses[].errors[].message` | string | 是 | - |

### ListCategories

- 方法：`POST /v1/categories/list`

- 用途：Lists all available product categories in the catalog.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/content/content-service-list-categories>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/categories/list' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `(body)` | object | 是 | - |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `categories` | array<string> | 是 | A list of unique category codes. These codes represent the full hierarchy path for a specific product type (e.g., family-type-subtype). |

### ListCategoryAttributes

- 方法：`POST /v1/categories/attributes/list`

- 用途：Retrieves the attributes for a specified product category.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/content/content-service-list-category-attributes>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/categories/attributes/list' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `category_code` | string | 是 | category code representing the product's classification in the catalog obtained from categories/list API |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `attributes` | array<object> | 是 | - |
| `attributes[].attribute_code` | string | 是 | unique identifier for the attribute |
| `attributes[].is_mandatory` | boolean | 是 | if True, attribute is required for product creation |
| `attributes[].is_facet` | boolean | 是 | If True, attribute is indexed for customer search filters on the storefront |
| `attributes[].attribute_type` | string enum | 是 | input format of the attribute value |
| `attributes[].is_localizable` | boolean | 是 | If True, the value can differ based on the region or language |
| `attributes[].is_multivalued` | boolean | 是 | if True, the attribute can have multiple values |
| `attributes[].max_values` | integer(int32) | 否 | max number of values allowed if attribute is multivalued |
| `attributes[].min_characters` | integer(int32) | 否 | minimum string length allowed for text attributes |
| `attributes[].max_characters` | integer(int32) | 否 | maximum string length allowed for text attributes |
| `attributes[].is_html_allowed` | boolean | 否 | if True, HTML content is allowed in text attributes |
| `attributes[].allowed_html_tags` | array<string> | 是 | An exclusive list of specific HTML tags allowed, if is_html_allowed is True |
| `attributes[].number_min` | number(double) | 否 | minimum number allowed for numeric attributes |
| `attributes[].number_max` | number(double) | 否 | maximum number allowed for numeric attributes |
| `attributes[].is_negative_allowed` | boolean | 否 | if True, numeric field accepts negative numbers |
| `attributes[].date_min` | string(date-time) | 否 | The earliest allowed date (ISO 8601 format) for datetime attributes. |
| `attributes[].date_max` | string(date-time) | 否 | The latest allowed date (ISO 8601 format) for datetime attributes. |
| `attributes[].min_size_in_kilobytes` | number(double) | 否 | minimum file size in kilobytes allowed for file attributes |
| `attributes[].max_size_in_kilobytes` | number(double) | 否 | maximum file size in kilobytes allowed for file attributes |
| `attributes[].allowed_mimetypes` | array<string> | 是 | list of allowed file formats for file attributes |
| `attributes[].additional_validation_regex` | string | 否 | custom regex pattern text attributes must match |
| `attributes[].attribute_options` | array<string> | 是 | exclusive list of allowed options for select attributes |
| `attributes[].attribute_metric_units` | array<string> | 是 | exclusive list of allowed metric units for metric attributes metric attributes require both a numeric value and a unit |

### UpsertProduct

- 方法：`POST /v1/product/upsert`

- 用途：Creates or updates a product in the catalog.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/content/content-service-upsert-product>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/product/upsert' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `skus` | array<object> | 是 | list of stock-keeping units it needs to contain at least one SKU in case of single SKU for a product, the size field is optional in case of multiple SKUs (sizes) for a product, all SKUs must have the size field specified in case of update, all SKUs must belong to the same parent product |
| `skus[].partner_sku` | string | 是 | Your internal unique identifier for this specific variation. It has to be unique across all your products. |
| `skus[].size` | string | 否 | The specific size value for this SKU (e.g., Large, 42, S). It should reflect the actual label size. |
| `brand` | string | 是 | brand name of the product |
| `category` | string | 是 | category code representing the product's classification in the catalog obtained from categories/list API |
| `images` | array<object> | 是 | images associated with the product |
| `images[].url` | string | 是 | The direct public URL where the image is hosted |
| `images[].sort` | integer(int64) | 是 | The display order (starting at 1) |
| `attributes` | object | 是 | dictionary of attribute codes to their corresponding values |
| `attributes` | object | 否 | dictionary of attribute codes to their corresponding values |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `sku_parent` | string | 是 | sku_parent of the created or updated product |
| `variants` | array<object> | 是 | product variants that were created or updated |
| `variants[].sku` | string | 是 | SKU of the product variant |
| `variants[].partner_sku` | string | 是 | partner provided SKU of the product variant |
| `variants[].psku_code` | string | 是 | - |
| `variants[].size` | string | 否 | size of the product variant |
| `status` | object | 是 | The `Status` type defines a logical error model that is suitable for different programming environments, including REST APIs and RPC APIs. It is used by [gRPC](https://github.com/grpc). Each `Status` message contains three pieces of data: error code, error message, and error details. You can find out more about this error model and how to work with it in the [API Design Guide](https://cloud.google.com/apis/design/errors). |
| `status.status_id` | integer(int32) | 否 | - |
| `status.status_code` | string | 否 | - |
| `status.message` | string | 否 | - |
| `status.details` | array<object> | 否 | - |


## FULFILLMENT / FBPI

### AddShipmentCourierAwbs

- 方法：`POST /v1/shipment/courier-awbs/add`

- 用途：Allows adding the courier and AWB number in case warehouse operations encounter scanning issues with the current one.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/fbpi/fbpi-service-add-shipment-courier-awbs>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/shipment/courier-awbs/add' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `warehouse_code` | string | 是 | Integration warehouse code. |
| `integration_shipment_nr` | string | 是 | The shipment identifier to update. |
| `awbs` | array<object> | 是 | courier and AWB details to be added. |
| `awbs[].courier` | string | 是 | Courier name — 'noon' or your own logistics provider. |
| `awbs[].awb_nr` | string | 是 | AWB number — either noon-generated or your own. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `(body)` | object | 否 | - |

### CancelShipment

- 方法：`POST /v1/shipment/cancel`

- 用途：Cancels an existing shipment. All items included in that shipment will also be canceled

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/fbpi/fbpi-service-cancel-shipment>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/shipment/cancel' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `warehouse_code` | string | 是 | Integration warehouse code. |
| `integration_shipment_nr` | string | 是 | Shipment number to be canceled. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `(body)` | object | 否 | - |

### CreateSandboxOrder

- 方法：`POST /v1/sandbox-order/create`

- 用途：Creates a test order in the sandbox environment so you can safely test FBPI APIs end-to-end without affecting real data or fulfillment. The sandbox order is created with the same shape as a real marketplace order and triggers the standard order-creation webhook to your configured endpoint. Once created, you can call any FBPI API against this order to fetch its details, update item statuses, create shipments, cancel shipments, and explore the full integration flow. Sandbox orders never result in real fulfillment, and any identifiers returned (such as AWBs) are for testing purposes only and cannot be tracked. Sandbox orders are automatically deleted after a fixed retention period.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/fbpi/fbpi-service-create-sandbox-order>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/sandbox-order/create' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `warehouse_code` | string | 是 | The integration warehouse code where the sandbox order will be placed. Must be a warehouse you have already configured to receive order webhooks. |
| `idempotency_key` | string | 是 | /Fill this with a unique key to ensure idempotency to your request /The length of this key can be at most 10 characters |
| `items` | array<object> | 是 | The items to include in the sandbox order. Each entry creates one item on the order with the specified status. |
| `items[].status` | string enum | 是 | The marketplace status to assign to this sandbox item (confirmed or cancelled). |
| `items[].partner_sku` | string | 否 | Optional partner SKU for sandbox orders. If omitted or empty, the server assigns a dummy value. No validation is performed and it does not need to match a real SKU. |
| `country_code` | string | 否 | Optional country code (ae, sa or eg). If left empty the system assigns `ae` as a default |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `fbpi_order_nr` | string | 是 | A sandbox FBPI order number generated for this order. Use this fbpi_order_nr to call getFbpiOrder to get the order details |

### CreateShipment

- 方法：`POST /v1/shipment/create`

- 用途：Used to create a shipment for an order. Each shipment must have a unique integration_shipment_nr and a valid AWB (Air Waybill) number. You can either use a Noon-generated AWB or your own courier’s AWB.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/fbpi/fbpi-service-create-shipment>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/shipment/create' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `warehouse_code` | string | 是 | The integration warehouse code handling the order. |
| `integration_shipment_nr` | string | 是 | Unique identifier for the shipment, No specific format enforced. |
| `fbpi_order_nr` | string | 是 | The FBPI order number linked to this shipment. |
| `awbs` | array<object> | 是 | Array containing courier and AWB number details. |
| `awbs[].courier` | string | 是 | Courier name — 'noon' or your own logistics provider. |
| `awbs[].awb_nr` | string | 是 | AWB number — either noon-generated or your own. |
| `items` | array<object> | 是 | Array of items included in this shipment. |
| `items[].mp_item_nr` | string | 是 | Marketplace item number to be included in this shipment. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `(body)` | object | 否 | - |

### GetFbpiOrder

- 方法：`GET /v1/fbpi-order/{fbpi_order_nr}/get`

- 用途：A webhook will be sent to your system containing theorder details whenever an order is created from the marketplace (Noon or Namshi). You can then use the fbpi_order_nr from the webhookto call this endpoint and retrieve full order details.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/fbpi/fbpi-service-get-fbpi-order>

- 使用方法：

```bash
curl -X GET 'https://<base-url>/v1/fbpi-order/{fbpi_order_nr}/get' \
  -H 'Authorization: Bearer <token>'
```

**路径/查询/Header 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `fbpi_order_nr` | string | 是 | path。The order number used in the request. |

**请求 Body 参数**

_无明确参数。_

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `fbpi_order_nr` | string | 是 | The order number passed in the request. |
| `mp_code` | string | 是 | Marketplace source: 'noon' or 'namshi'. |
| `mp_order_nr` | string | 是 | The marketplace order number retrieved from the Order. |
| `mp_country_code` | string | 是 | Marketplace country code (e.g., ae, sa, eg). |
| `customer_country_code` | string | 是 | The country from which the customer placed the order. |
| `merchant_code` | string | 是 | The merchant identifier, prefixed with STR. |
| `currency_code` | string | 是 | The customer’s local currency. |
| `warehouse_code` | string | 是 | Integration warehouse code where the order will be fulfilled. |
| `items` | array<object> | 是 | Array of items included in the order. |
| `items[].mp_item_nr` | string | 是 | Marketplace item number. |
| `items[].partner_sku` | string | 是 | Partner SKU for that item. |
| `items[].mp_status` | string enum | 是 | Marketplace status of the item (confirmed or cancelled). |
| `items[].integration_status` | string enum | 是 | Integration status of the item (acknowledged, out of stock, or shipped). |
| `items[].delivered_invoice_price` | number(double) | 是 | The invoiced price of the delivered item. |
| `items[].cancellation_reason_code` | string | 否 | Reason code explaining why the item was cancelled, if applicable. |
| `order_created_at` | string | 是 | Timestamp of when the order was created. |

### GetFbpiOrderCustomerData

- 方法：`GET /v1/fbpi-order/{fbpi_order_nr}/customer-details/get`

- 用途：Provides customer details for a given FBPI order, including their name, city, and administrative division.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/fbpi/fbpi-service-get-fbpi-order-customer-data>

- 使用方法：

```bash
curl -X GET 'https://<base-url>/v1/fbpi-order/{fbpi_order_nr}/customer-details/get' \
  -H 'Authorization: Bearer <token>'
```

**路径/查询/Header 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `fbpi_order_nr` | string | 是 | path。The FBPI order number you received via webhook. |

**请求 Body 参数**

_无明确参数。_

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `first_name` | string | 是 | Customer first name in latin characters. |
| `last_name` | string | 是 | Customer last name in latin characters. |
| `city` | string | 是 | Customer city in latin characters. |
| `administrative_division` | string | 是 | Customer administrative division in latin characters. |

### GetNoonLogisticsAWBs

- 方法：`POST /v1/shipment/noon-logistics-awbs/get`

- 用途：Generates Noon AWB numbers to be used when creating shipments. You can generate a single AWB per shipment or request up to 1000 AWBs in bulk and store them for future use.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/fbpi/fbpi-service-get-noon-logistics-aw-bs>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/shipment/noon-logistics-awbs/get' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `country_code` | string | 是 | Operating warehouse country code (e.g., ae, sa, eg). |
| `qty` | integer(int64) | 是 | Number of AWBs to generate. Maximum 1000 per request. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `awb_nrs` | array<string> | 是 | The generated noon AWB numbers, one per requested quantity. |

### GetShipment

- 方法：`POST /v1/shipment/get`

- 用途：Retrieves shipment details for a specific order and shipment number.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/fbpi/fbpi-service-get-shipment>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/shipment/get' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `warehouse_code` | string | 是 | Integration warehouse code. |
| `integration_shipment_nr` | string | 是 | The shipment number mapped to that order. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `fbpi_order_nr` | string | 是 | The order number associated with the shipment. |
| `awbs` | array<object> | 是 | AWB details used for this shipment. |
| `awbs[].courier` | string | 是 | Courier name — 'noon' or your own logistics provider. |
| `awbs[].awb_nr` | string | 是 | AWB number — either noon-generated or your own. |
| `items` | array<object> | 是 | Items included in this shipment. |
| `items[].mp_item_nr` | string | 是 | Marketplace item number. |
| `items[].partner_sku` | string | 是 | Partner SKU for that item. |

### ListFbpiOrders

- 方法：`POST /v1/fbpi-orders/list`

- 用途：Retrieves a paginated list of FBPI orders for a specific warehouse with optional filtering by order creation date range. Use the created_after and created_before filters to limit results to orders created within a specific UTC time window.If no date filters are provided,all available orders for the specified warehouse will be returned.Results are returned in pages of up to 50 orders. To retrieve additional pages,include the next_token query parameter returned in the previous response. When paginating, you must reuse the same filters applied in the initial request. The next_token controls pagination only and does not modify the result set.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/fbpi/fbpi-service-list-fbpi-orders>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/fbpi-orders/list' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `next_token` | string | 是 | query。used for pagination. When requesting pages after the first, provide the token returned by your previous request, and do not change the filters applied in the first page when sending the token. |

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `warehouse_code` | string | 是 | The integration warehouse code whose orders should be listed. |
| `created_after` | string | 否 | created_after / created_before: UTC timestamp in ISO-8601 format(YYYY-MM-DDTHH:MM:SSZ). Use these to limit the returned orders to those created within the inclusive date range. If omitted, no date filtering is applied. |
| `created_before` | string | 否 | - |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `next_token` | string | 是 | the next token that should be put in the query parameter of the next page request |
| `orders` | array<object> | 是 | this is an array of less than or 50 items |
| `orders[].fbpi_order_nr` | string | 是 | The order number passed in the request. |
| `orders[].mp_code` | string | 是 | Marketplace source: 'noon' or 'namshi'. |
| `orders[].mp_order_nr` | string | 是 | The marketplace order number retrieved from the Order. |
| `orders[].mp_country_code` | string | 是 | Marketplace country code (e.g., ae, sa, eg). |
| `orders[].customer_country_code` | string | 是 | The country from which the customer placed the order. |
| `orders[].merchant_code` | string | 是 | The merchant identifier, prefixed with STR. |
| `orders[].currency_code` | string | 是 | The customer’s local currency. |
| `orders[].warehouse_code` | string | 是 | Integration warehouse code where the order will be fulfilled. |
| `orders[].items` | array<object> | 是 | Array of items included in the order. |
| `orders[].items[].mp_item_nr` | string | 是 | Marketplace item number. |
| `orders[].items[].partner_sku` | string | 是 | Partner SKU for that item. |
| `orders[].items[].mp_status` | string enum | 是 | Marketplace status of the item (confirmed or cancelled). |
| `orders[].items[].integration_status` | string enum | 是 | Integration status of the item (acknowledged, out of stock, or shipped). |
| `orders[].items[].delivered_invoice_price` | number(double) | 是 | The invoiced price of the delivered item. |
| `orders[].items[].cancellation_reason_code` | string | 否 | Reason code explaining why the item was cancelled, if applicable. |
| `orders[].order_created_at` | string | 是 | Timestamp of when the order was created. |

### UpdateOrder

- 方法：`POST /v1/fbpi-order/update`

- 用途：If the warehouse stock does not match the received order,this API allows you to mark one or more items as unavailable before shipment creation. The unavailable items will be canceled on Noon’s side,and the rest will proceed to fulfillment.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/fbpi/fbpi-service-update-order>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/fbpi-order/update' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `fbpi_order_nr` | string | 是 | The FBPI order number to update. |
| `items` | array<object> | 是 | Array of items to cancel before shipment creation. |
| `items[].mp_item_nr` | string | 是 | Marketplace item number to exclude from fulfillment. |
| `items[].status` | string enum | 是 | Status to mark item as out of stock. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `(body)` | object | 否 | - |


## FULFILLMENT / FBPO

### GetPurchaseOrder

- 方法：`GET /v1/po/{po_nr}/get`

- 用途：Retrieves the details of a specific purchase order by its number.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/fbpo/fbpo-service-get-po>

- 使用方法：

```bash
curl -X GET 'https://<base-url>/v1/po/{po_nr}/get' \
  -H 'Authorization: Bearer <token>'
```

**路径/查询/Header 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `po_nr` | string | 是 | path。The pucharse order number used in the request. |

**请求 Body 参数**

_无明确参数。_

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `po_nr` | string | 是 | The pucharse order number passed in the request. |
| `po_currency` | string | 是 | The currency of that purchase order. |
| `merchant_code` | string | 是 | The merchant identifier, prefixed with STR. |
| `warehouse_code` | string | 是 | Partner warehouse code representing the warehouse responsible for fulfilling the purchase order. |
| `po_status` | string enum | 是 | The status of the purchase order, stating whether it is "Pending" or "Released". |
| `po_release_date` | object | 是 | The release date of that purchase order. |
| `po_release_date.year` | integer(int32) | 是 | Year of the date. Must be from 1 to 9999, or 0 to specify a date without a year. |
| `po_release_date.month` | integer(int32) | 是 | Month of a year. Must be from 1 to 12, or 0 to specify a year without a month and day. |
| `po_release_date.day` | integer(int32) | 是 | Day of a month. Must be from 1 to 31 and valid for the year and month, or 0 to specify a year by itself or a year and month where the day isn't significant. |
| `po_lines` | array<object> | 是 | Array of purchase order lines included in that purchase order. |
| `po_lines[].partner_sku` | string | 是 | Partner SKU for that item. |
| `po_lines[].qty` | integer(int32) | 是 | Quantity needed for that item. |
| `po_lines[].unit_cost` | number(double) | 是 | Unit cost of that item. |


## FULFILLMENT / FBN Inbound

### CreateShipment

- 方法：`POST /v1/shipment/create`

- 用途：Creates a new inbound shipment (ASN) header in CREATED status with no items. Use UpdateShipmentItems to add items after creation. Idempotent: retrying with the same exref_nr and shipment_type returns the existing ASN instead of creating a duplicate.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/inbound/asn-service-create-shipment>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/shipment/create' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `shipment_type` | string enum | 是 | Type of shipment. |
| `exref_nr` | string | 是 | Partner's external reference for the ASN (e.g., PO number). Must be unique per shipment_type within your account. |
| `country_code` | string | 是 | Destination country code (e.g., AE, SA). |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `shipment` | object | 是 | The created shipment header. |
| `shipment.asn_nr` | string | 是 | ASN reference number. |
| `shipment.exref_nr` | string | 是 | External reference number. |
| `shipment.shipment_type` | string enum | 是 | Type of shipment. |
| `shipment.status` | string enum | 是 | Current ASN status. |
| `shipment.country_code` | string | 是 | Country code provided during shipment creation. |
| `shipment.dst_warehouse_code` | string | 否 | Destination FBN warehouse code. Null until scheduled. |
| `shipment.expected_qty` | integer(int32) | 是 | Expected total quantity across all items. |
| `shipment.schedule_date` | string | 否 | Scheduled inbound date (YYYY-MM-DD). Null if not scheduled. |
| `shipment.schedule_slot` | object | 是 | Scheduled time slot. Null if not scheduled. |
| `shipment.schedule_slot.start` | string | 是 | Slot start time. Format: HH:MM (e.g., "08:00"). |
| `shipment.schedule_slot.end` | string | 是 | Slot end time. Format: HH:MM (e.g., "12:00"). |
| `shipment.delivery_type` | string enum | 否 | Delivery type (e.g., drop-off or pickup). Null if not set. |
| `shipment.qty_received` | integer(int32) | 是 | Quantity physically received at the warehouse. Populated after inbounding. |
| `shipment.qty_putaway` | integer(int32) | 是 | Quantity successfully put away in the warehouse. Populated after putaway. |
| `shipment.total_sku_count` | integer(int32) | 是 | Total number of distinct SKUs on this ASN. |
| `shipment.created_at` | string | 是 | Creation timestamp. Format: ISO 8601 (e.g., "2026-03-09T14:30:00Z"). |
| `shipment.updated_at` | string | 是 | Last update timestamp. Format: ISO 8601 (e.g., "2026-03-09T14:30:00Z"). |

### DeleteShipmentItems

- 方法：`POST /v1/shipment/items/delete`

- 用途：Removes one or more items from a draft ASN. Maximum 1000 items per request. ASN must be in CREATED status. Items cannot be deleted after sealing. Deleting all items is allowed — the ASN remains in CREATED status.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/inbound/asn-service-delete-shipment-items>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/shipment/items/delete' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `asn_nr` | string | 是 | ASN reference to delete items from. Must be in CREATED status. |
| `partner_skus` | array<string> | 是 | List of partner_sku to delete. Maximum 1000 per request. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `shipment` | object | 是 | Updated shipment header. |
| `shipment.asn_nr` | string | 是 | ASN reference number. |
| `shipment.exref_nr` | string | 是 | External reference number. |
| `shipment.shipment_type` | string enum | 是 | Type of shipment. |
| `shipment.status` | string enum | 是 | Current ASN status. |
| `shipment.country_code` | string | 是 | Country code provided during shipment creation. |
| `shipment.dst_warehouse_code` | string | 否 | Destination FBN warehouse code. Null until scheduled. |
| `shipment.expected_qty` | integer(int32) | 是 | Expected total quantity across all items. |
| `shipment.schedule_date` | string | 否 | Scheduled inbound date (YYYY-MM-DD). Null if not scheduled. |
| `shipment.schedule_slot` | object | 是 | Scheduled time slot. Null if not scheduled. |
| `shipment.schedule_slot.start` | string | 是 | Slot start time. Format: HH:MM (e.g., "08:00"). |
| `shipment.schedule_slot.end` | string | 是 | Slot end time. Format: HH:MM (e.g., "12:00"). |
| `shipment.delivery_type` | string enum | 否 | Delivery type (e.g., drop-off or pickup). Null if not set. |
| `shipment.qty_received` | integer(int32) | 是 | Quantity physically received at the warehouse. Populated after inbounding. |
| `shipment.qty_putaway` | integer(int32) | 是 | Quantity successfully put away in the warehouse. Populated after putaway. |
| `shipment.total_sku_count` | integer(int32) | 是 | Total number of distinct SKUs on this ASN. |
| `shipment.created_at` | string | 是 | Creation timestamp. Format: ISO 8601 (e.g., "2026-03-09T14:30:00Z"). |
| `shipment.updated_at` | string | 是 | Last update timestamp. Format: ISO 8601 (e.g., "2026-03-09T14:30:00Z"). |

### GetShipment

- 方法：`GET /v1/shipment/{asn_nr}`

- 用途：Retrieves ASN details (header only).

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/inbound/asn-service-get-shipment>

- 使用方法：

```bash
curl -X GET 'https://<base-url>/v1/shipment/{asn_nr}' \
  -H 'Authorization: Bearer <token>'
```

**路径/查询/Header 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `asn_nr` | string | 是 | path。ASN reference number. |

**请求 Body 参数**

_无明确参数。_

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `shipment` | object | 是 | Shipment details. |
| `shipment.asn_nr` | string | 是 | ASN reference number. |
| `shipment.exref_nr` | string | 是 | External reference number. |
| `shipment.shipment_type` | string enum | 是 | Type of shipment. |
| `shipment.status` | string enum | 是 | Current ASN status. |
| `shipment.country_code` | string | 是 | Country code provided during shipment creation. |
| `shipment.dst_warehouse_code` | string | 否 | Destination FBN warehouse code. Null until scheduled. |
| `shipment.expected_qty` | integer(int32) | 是 | Expected total quantity across all items. |
| `shipment.schedule_date` | string | 否 | Scheduled inbound date (YYYY-MM-DD). Null if not scheduled. |
| `shipment.schedule_slot` | object | 是 | Scheduled time slot. Null if not scheduled. |
| `shipment.schedule_slot.start` | string | 是 | Slot start time. Format: HH:MM (e.g., "08:00"). |
| `shipment.schedule_slot.end` | string | 是 | Slot end time. Format: HH:MM (e.g., "12:00"). |
| `shipment.delivery_type` | string enum | 否 | Delivery type (e.g., drop-off or pickup). Null if not set. |
| `shipment.qty_received` | integer(int32) | 是 | Quantity physically received at the warehouse. Populated after inbounding. |
| `shipment.qty_putaway` | integer(int32) | 是 | Quantity successfully put away in the warehouse. Populated after putaway. |
| `shipment.total_sku_count` | integer(int32) | 是 | Total number of distinct SKUs on this ASN. |
| `shipment.created_at` | string | 是 | Creation timestamp. Format: ISO 8601 (e.g., "2026-03-09T14:30:00Z"). |
| `shipment.updated_at` | string | 是 | Last update timestamp. Format: ISO 8601 (e.g., "2026-03-09T14:30:00Z"). |

### GetSlotAvailability

- 方法：`GET /v1/shipment/{asn_nr}/schedule/slot_availability`

- 用途：Returns eligible destination warehouses with their available check-in days and time slots. ASN must be in SEALED status. Only future dates with remaining capacity are returned. Use the returned warehouse code, date, and slot when calling ScheduleShipment.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/inbound/asn-service-get-slot-availability>

- 使用方法：

```bash
curl -X GET 'https://<base-url>/v1/shipment/{asn_nr}/schedule/slot_availability' \
  -H 'Authorization: Bearer <token>'
```

**路径/查询/Header 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `asn_nr` | string | 是 | path。ASN reference. ASN must be in SEALED status. |

**请求 Body 参数**

_无明确参数。_

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `warehouses` | array<object> | 是 | List of eligible warehouses with their available check-in days and slots. The list is capped server-side and will contain at most 100 warehouses. |
| `warehouses[].warehouse` | object | 是 | Eligible warehouse. |
| `warehouses[].warehouse.warehouse_code` | string | 是 | Warehouse code. |
| `warehouses[].warehouse.name` | string | 是 | Warehouse name. |
| `warehouses[].warehouse.address` | string | 是 | Street address. |
| `warehouses[].warehouse.city` | string | 是 | City. |
| `warehouses[].warehouse.location` | object | 是 | Warehouse location (latitude and longitude). |
| `warehouses[].days` | array<object> | 是 | Available upcoming check-in days and time slots for this warehouse (max 30 days per warehouse). |
| `warehouses[].days[].date` | string | 是 | Available date. Format: YYYY-MM-DD. |
| `warehouses[].days[].slots` | array<object> | 是 | Available time slots for that date. Maximum 8 slots per day. |

### ListShipmentItems

- 方法：`GET /v1/shipment/{asn_nr}/items`

- 用途：Returns a paginated list of items on an ASN. Use this to retrieve the full item list for a shipment.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/inbound/asn-service-list-shipment-items>

- 使用方法：

```bash
curl -X GET 'https://<base-url>/v1/shipment/{asn_nr}/items' \
  -H 'Authorization: Bearer <token>'
```

**路径/查询/Header 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `asn_nr` | string | 是 | path。ASN reference number. |
| `next_token` | string | 是 | query。Pagination token from a previous response. Omit for the first page. |
| `page_size` | integer(int32) | 是 | query。Number of items per page. Default 1000, max 1000. |

**请求 Body 参数**

_无明确参数。_

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | List of items on this ASN with full product details. |
| `items[].partner_sku` | string | 是 | Partner SKU identifier. |
| `items[].sku` | string | 是 | Internal noon SKU. |
| `items[].title` | string | 是 | Product title. |
| `items[].qty` | integer(int32) | 是 | Quantity of the item. |
| `items[].storage_type` | string enum | 是 | Storage type. |
| `items[].image_url` | string | 是 | Product image URL. |
| `next_token` | string | 否 | Token to fetch the next page. Null if this is the last page. |
| `total_sku_count` | integer(int32) | 是 | Total number of distinct SKUs on this ASN (across all pages). |

### ListShipments

- 方法：`GET /v1/shipment/list`

- 用途：Returns a paginated list of shipment headers (without items). Filters are sent via query parameters, so GET is used. Use the nested filter fields to narrow results, e.g., `filter.status=...`.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/inbound/asn-service-list-shipments>

- 使用方法：

```bash
curl -X GET 'https://<base-url>/v1/shipment/list' \
  -H 'Authorization: Bearer <token>'
```

**路径/查询/Header 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `next_token` | string | 是 | query。Pagination token from a previous response. Omit for the first page. |
| `filter.status` | string enum | 是 | query。Filter by ASN status. |
| `page_size` | integer(int32) | 是 | query。Number of records per page. Default 50, max 200. |
| `country_code` | string | 是 | query。Destination country code (e.g., AE, SA). |

**请求 Body 参数**

_无明确参数。_

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `next_token` | string | 否 | Token to fetch the next page. Empty string if there are no more pages. |
| `shipments` | array<object> | 是 | List of shipment headers (without items). At most page_size shipments are returned per page (max 200). |
| `shipments[].asn_nr` | string | 是 | ASN reference number. |
| `shipments[].exref_nr` | string | 是 | External reference number. |
| `shipments[].shipment_type` | string enum | 是 | Type of shipment. |
| `shipments[].status` | string enum | 是 | Current ASN status. |
| `shipments[].country_code` | string | 是 | Country code provided during shipment creation. |
| `shipments[].dst_warehouse_code` | string | 否 | Destination FBN warehouse code. Null until scheduled. |
| `shipments[].expected_qty` | integer(int32) | 是 | Expected total quantity across all items. |
| `shipments[].schedule_date` | string | 否 | Scheduled inbound date (YYYY-MM-DD). Null if not scheduled. |
| `shipments[].schedule_slot` | object | 是 | Scheduled time slot. Null if not scheduled. |
| `shipments[].schedule_slot.start` | string | 是 | Slot start time. Format: HH:MM (e.g., "08:00"). |
| `shipments[].schedule_slot.end` | string | 是 | Slot end time. Format: HH:MM (e.g., "12:00"). |
| `shipments[].delivery_type` | string enum | 否 | Delivery type (e.g., drop-off or pickup). Null if not set. |
| `shipments[].qty_received` | integer(int32) | 是 | Quantity physically received at the warehouse. Populated after inbounding. |
| `shipments[].qty_putaway` | integer(int32) | 是 | Quantity successfully put away in the warehouse. Populated after putaway. |
| `shipments[].total_sku_count` | integer(int32) | 是 | Total number of distinct SKUs on this ASN. |
| `shipments[].created_at` | string | 是 | Creation timestamp. Format: ISO 8601 (e.g., "2026-03-09T14:30:00Z"). |
| `shipments[].updated_at` | string | 是 | Last update timestamp. Format: ISO 8601 (e.g., "2026-03-09T14:30:00Z"). |
| `total_count` | integer(int32) | 是 | Total number of shipments for this partner. |

### ScheduleShipment

- 方法：`POST /v1/shipment/schedule`

- 用途：Schedules a sealed ASN for inbound delivery at a specific warehouse, date, and time slot. This also assigns the destination warehouse to the ASN. ASN must be in SEALED status. State transition: SEALED -> SCHEDULED. Fails if the warehouse is not eligible, the slot is no longer available, or the date is in the past.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/inbound/asn-service-schedule-shipment>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/shipment/schedule' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `asn_nr` | string | 是 | ASN reference to schedule. Must be in SEALED status. |
| `dst_warehouse_code` | string | 是 | Destination warehouse code. Use the GetSlotAvailability API to get eligible warehouses. |
| `schedule_date` | string | 是 | Requested schedule date. Format: YYYY-MM-DD. |
| `schedule_slot` | object | 是 | Requested time slot from GetSlotAvailability. |
| `schedule_slot.start` | string | 是 | Slot start time. Format: HH:MM (e.g., "08:00"). |
| `schedule_slot.end` | string | 是 | Slot end time. Format: HH:MM (e.g., "12:00"). |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `shipment` | object | 是 | Updated shipment header with warehouse and schedule details. |
| `shipment.asn_nr` | string | 是 | ASN reference number. |
| `shipment.exref_nr` | string | 是 | External reference number. |
| `shipment.shipment_type` | string enum | 是 | Type of shipment. |
| `shipment.status` | string enum | 是 | Current ASN status. |
| `shipment.country_code` | string | 是 | Country code provided during shipment creation. |
| `shipment.dst_warehouse_code` | string | 否 | Destination FBN warehouse code. Null until scheduled. |
| `shipment.expected_qty` | integer(int32) | 是 | Expected total quantity across all items. |
| `shipment.schedule_date` | string | 否 | Scheduled inbound date (YYYY-MM-DD). Null if not scheduled. |
| `shipment.schedule_slot` | object | 是 | Scheduled time slot. Null if not scheduled. |
| `shipment.schedule_slot.start` | string | 是 | Slot start time. Format: HH:MM (e.g., "08:00"). |
| `shipment.schedule_slot.end` | string | 是 | Slot end time. Format: HH:MM (e.g., "12:00"). |
| `shipment.delivery_type` | string enum | 否 | Delivery type (e.g., drop-off or pickup). Null if not set. |
| `shipment.qty_received` | integer(int32) | 是 | Quantity physically received at the warehouse. Populated after inbounding. |
| `shipment.qty_putaway` | integer(int32) | 是 | Quantity successfully put away in the warehouse. Populated after putaway. |
| `shipment.total_sku_count` | integer(int32) | 是 | Total number of distinct SKUs on this ASN. |
| `shipment.created_at` | string | 是 | Creation timestamp. Format: ISO 8601 (e.g., "2026-03-09T14:30:00Z"). |
| `shipment.updated_at` | string | 是 | Last update timestamp. Format: ISO 8601 (e.g., "2026-03-09T14:30:00Z"). |

### UpdateShipment

- 方法：`POST /v1/shipment/update`

- 用途：Updates shipment metadata. Allowed while ASN is in CREATED, SEALED, or SCHEDULED status. Cannot be updated once inbound has started, or if expired or canceled.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/inbound/asn-service-update-shipment>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/shipment/update' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `asn_nr` | string | 是 | ASN reference to update. |
| `misc` | object | 是 | Additional metadata (e.g., 3PL flags). Schema not yet finalized — will be replaced with a typed message once requirements are confirmed. |
| `misc` | object | 否 | Additional metadata (e.g., 3PL flags). Schema not yet finalized — will be replaced with a typed message once requirements are confirmed. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `shipment` | object | 是 | The updated shipment header. |
| `shipment.asn_nr` | string | 是 | ASN reference number. |
| `shipment.exref_nr` | string | 是 | External reference number. |
| `shipment.shipment_type` | string enum | 是 | Type of shipment. |
| `shipment.status` | string enum | 是 | Current ASN status. |
| `shipment.country_code` | string | 是 | Country code provided during shipment creation. |
| `shipment.dst_warehouse_code` | string | 否 | Destination FBN warehouse code. Null until scheduled. |
| `shipment.expected_qty` | integer(int32) | 是 | Expected total quantity across all items. |
| `shipment.schedule_date` | string | 否 | Scheduled inbound date (YYYY-MM-DD). Null if not scheduled. |
| `shipment.schedule_slot` | object | 是 | Scheduled time slot. Null if not scheduled. |
| `shipment.schedule_slot.start` | string | 是 | Slot start time. Format: HH:MM (e.g., "08:00"). |
| `shipment.schedule_slot.end` | string | 是 | Slot end time. Format: HH:MM (e.g., "12:00"). |
| `shipment.delivery_type` | string enum | 否 | Delivery type (e.g., drop-off or pickup). Null if not set. |
| `shipment.qty_received` | integer(int32) | 是 | Quantity physically received at the warehouse. Populated after inbounding. |
| `shipment.qty_putaway` | integer(int32) | 是 | Quantity successfully put away in the warehouse. Populated after putaway. |
| `shipment.total_sku_count` | integer(int32) | 是 | Total number of distinct SKUs on this ASN. |
| `shipment.created_at` | string | 是 | Creation timestamp. Format: ISO 8601 (e.g., "2026-03-09T14:30:00Z"). |
| `shipment.updated_at` | string | 是 | Last update timestamp. Format: ISO 8601 (e.g., "2026-03-09T14:30:00Z"). |

### UpdateShipmentItems

- 方法：`POST /v1/shipment/items/update`

- 用途：Adds new items or updates quantities on existing items for a draft ASN (upsert). If an item with the same partner_sku already exists, its quantity is updated; otherwise a new item is added. Maximum 1000 items per request. For larger shipments, split across multiple calls. ASN must be in CREATED status.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/inbound/asn-service-update-shipment-items>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/shipment/items/update' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `asn_nr` | string | 是 | ASN reference to update items for. Must be in CREATED status. |
| `items` | array<object> | 是 | List of items to add or update. Maximum 1000 items per request. |
| `items[].partner_sku` | string | 是 | Partner SKU identifier. |
| `items[].qty` | integer(int32) | 是 | Quantity of the item. |
| `items[].storage_type` | string enum | 是 | Storage type. Set by the partner or pre-determined from catalog. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `shipment` | object | 是 | Updated shipment header. |
| `shipment.asn_nr` | string | 是 | ASN reference number. |
| `shipment.exref_nr` | string | 是 | External reference number. |
| `shipment.shipment_type` | string enum | 是 | Type of shipment. |
| `shipment.status` | string enum | 是 | Current ASN status. |
| `shipment.country_code` | string | 是 | Country code provided during shipment creation. |
| `shipment.dst_warehouse_code` | string | 否 | Destination FBN warehouse code. Null until scheduled. |
| `shipment.expected_qty` | integer(int32) | 是 | Expected total quantity across all items. |
| `shipment.schedule_date` | string | 否 | Scheduled inbound date (YYYY-MM-DD). Null if not scheduled. |
| `shipment.schedule_slot` | object | 是 | Scheduled time slot. Null if not scheduled. |
| `shipment.schedule_slot.start` | string | 是 | Slot start time. Format: HH:MM (e.g., "08:00"). |
| `shipment.schedule_slot.end` | string | 是 | Slot end time. Format: HH:MM (e.g., "12:00"). |
| `shipment.delivery_type` | string enum | 否 | Delivery type (e.g., drop-off or pickup). Null if not set. |
| `shipment.qty_received` | integer(int32) | 是 | Quantity physically received at the warehouse. Populated after inbounding. |
| `shipment.qty_putaway` | integer(int32) | 是 | Quantity successfully put away in the warehouse. Populated after putaway. |
| `shipment.total_sku_count` | integer(int32) | 是 | Total number of distinct SKUs on this ASN. |
| `shipment.created_at` | string | 是 | Creation timestamp. Format: ISO 8601 (e.g., "2026-03-09T14:30:00Z"). |
| `shipment.updated_at` | string | 是 | Last update timestamp. Format: ISO 8601 (e.g., "2026-03-09T14:30:00Z"). |

### UpdateShipmentStatus

- 方法：`POST /v1/shipment/status/update`

- 用途：Transitions an ASN between lifecycle statuses. Supported actions: - seal: Finalize a draft ASN. Requires at least one item (CREATED -> SEALED) - cancel: Cancel an ASN from CREATED, SEALED, or SCHEDULED (-> CANCELED) - reschedule: Move a scheduled ASN back to SEALED (SCHEDULED -> SEALED)

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/inbound/asn-service-update-shipment-status>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/shipment/status/update' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `asn_nr` | string | 是 | ASN reference to transition. |
| `action` | string enum | 是 | Action to perform. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `shipment` | object | 是 | Updated shipment header. |
| `shipment.asn_nr` | string | 是 | ASN reference number. |
| `shipment.exref_nr` | string | 是 | External reference number. |
| `shipment.shipment_type` | string enum | 是 | Type of shipment. |
| `shipment.status` | string enum | 是 | Current ASN status. |
| `shipment.country_code` | string | 是 | Country code provided during shipment creation. |
| `shipment.dst_warehouse_code` | string | 否 | Destination FBN warehouse code. Null until scheduled. |
| `shipment.expected_qty` | integer(int32) | 是 | Expected total quantity across all items. |
| `shipment.schedule_date` | string | 否 | Scheduled inbound date (YYYY-MM-DD). Null if not scheduled. |
| `shipment.schedule_slot` | object | 是 | Scheduled time slot. Null if not scheduled. |
| `shipment.schedule_slot.start` | string | 是 | Slot start time. Format: HH:MM (e.g., "08:00"). |
| `shipment.schedule_slot.end` | string | 是 | Slot end time. Format: HH:MM (e.g., "12:00"). |
| `shipment.delivery_type` | string enum | 否 | Delivery type (e.g., drop-off or pickup). Null if not set. |
| `shipment.qty_received` | integer(int32) | 是 | Quantity physically received at the warehouse. Populated after inbounding. |
| `shipment.qty_putaway` | integer(int32) | 是 | Quantity successfully put away in the warehouse. Populated after putaway. |
| `shipment.total_sku_count` | integer(int32) | 是 | Total number of distinct SKUs on this ASN. |
| `shipment.created_at` | string | 是 | Creation timestamp. Format: ISO 8601 (e.g., "2026-03-09T14:30:00Z"). |
| `shipment.updated_at` | string | 是 | Last update timestamp. Format: ISO 8601 (e.g., "2026-03-09T14:30:00Z"). |

### asn-service-list-eligible-items

- 方法：`GET /v1/catalog/items`

- 用途：官方文档未提供详细描述。

- 官方页面：<https://noon-docs.noonpartners.dev/docs/>

- 使用方法：

```bash
curl -X GET 'https://<base-url>/v1/catalog/items' \
  -H 'Authorization: Bearer <token>'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

_无明确参数。_

**成功返回参数**

_无明确参数。_


## OPERATIONS / Warehouse Platform

### ListWarehouses

- 方法：`POST /v1/warehouses/list`

- 用途：Returns the list of warehouses associated with the partner. The list can be filtered by fulfillment system code, and supports pagination to manage large sets of warehouses effectively.

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/warehouse_platform/warehouse-platform-service-list-warehouses>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/warehouses/list' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `next_token` | string | 否 | Pagination cursor for retrieving the next page of results. Leave empty to retrieve the first page. |
| `filters` | object | 否 | Filters to apply when listing warehouses. When paginating, filters must remain identical between calls that share the same cursor. |
| `filters.fulfillment_system_code` | string | 否 | Filter warehouses by fulfillment system code. If not specified, all warehouses will be returned. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `next_token` | string | 否 | Pagination cursor for retrieving the next page of results. Empty string indicates that there are no subsequent pages. |
| `warehouses` | array<object> | 是 | The list of warehouses for this page. Contains at most 500 warehouses. |
| `warehouses[].warehouse_code` | string | 是 | The unique code of the warehouse. |
| `warehouses[].display_name` | string | 是 | The display name of the warehouse. |
| `warehouses[].fulfillment_system_code` | string | 是 | The fulfillment system code of the warehouse. |
| `warehouses[].is_active` | boolean | 是 | Whether the warehouse is active and can be used for fulfillment. |


## DATA / Reports

### CreateExport

- 方法：`POST /v1/export/create`

- 用途：Create an export request

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/impex/impex-service-create-export>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/export/create' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `export_category_code` | string | 是 | The category of data to export (must match an available export_category_code) |
| `params` | object | 是 | Parameters for the export. Structure depends on the export category |
| `params` | object | 否 | Parameters for the export. Structure depends on the export category |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `export_code` | string | 是 | Unique identifier for the created export job. Use this to check status and download results |

### GetExportCategoryList

- 方法：`GET /v1/export/category/list`

- 用途：Get export category list

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/impex/impex-service-get-export-category-list>

- 使用方法：

```bash
curl -X GET 'https://<base-url>/v1/export/category/list' \
  -H 'Authorization: Bearer <token>'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

_无明确参数。_

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `export_categories` | array<object> | 是 | List of all available export categories with their required parameters |
| `export_categories[].export_category_code` | string | 是 | Unique identifier for the export category |
| `export_categories[].params` | object | 是 | Additional parameters required for this export category (dynamic JSON structure) |
| `export_categories[].params` | object | 否 | Additional parameters required for this export category (dynamic JSON structure) |

### GetExportStatus

- 方法：`POST /v1/export/status`

- 用途：Get export details, status and download link

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/impex/impex-service-get-export-status>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/export/status' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `export_code` | string | 是 | The unique identifier of the export job to check |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `export_code` | string | 是 | Unique identifier for the export job |
| `export_category_code` | string | 是 | Category of data being exported |
| `export_status` | string | 是 | Current status of the export (e.g., "PENDING", "QUEUE", "RUNNING", "COMPLETE", "ERROR") |
| `params` | string | 是 | Parameters used for this export (JSON string representation) |
| `project_code` | string | 是 | Project identifier associated with this export |
| `created_by` | string | 是 | User that created this export |
| `download_url` | string | 否 | Download URL for the exported file (only available when export_status is "COMPLETE") |
| `created_at` | string | 是 | Timestamp when the export was created |
| `updated_at` | string | 是 | Timestamp when the export was last updated |


## OTHER / Event Notifications

### CreateHttpsDestination

- 方法：`POST /v1/destination/https-destination/create`

- 用途：Creates a new HTTPS webhook destination

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/event-notifications/event-notifications-service-create-https-destination>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/destination/https-destination/create' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `destination_name` | string | 是 | A name to identify this destination. This is for your reference and has no impact on the functionality. |
| `url` | string | 是 | The URL of your server where you want to receive event notifications. |
| `credentials` | object | 是 | Key-value pairs that will be sent as HTTP headers on each webhook request to your server. Use these to authenticate or identify incoming requests on your end. At least one credential entry is required. |
| `credentials.values` | object | 是 | A map of HTTP header name to header value. Each entry is sent as a header on every webhook request. Provide one entry per header you want included; the property name is the header name and the value is the header value. Example payload: "values": { "Authorization": "Bearer xxx", "x-api-key": "secret-123" } On read responses, values are redacted (e.g. "******"). |
| `credentials.values` | object | 否 | A map of HTTP header name to header value. Each entry is sent as a header on every webhook request. Provide one entry per header you want included; the property name is the header name and the value is the header value. Example payload: "values": { "Authorization": "Bearer xxx", "x-api-key": "secret-123" } On read responses, values are redacted (e.g. "******"). |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `destination_code` | string | 是 | A unique code that identifies this destination. Use this code for any API calls that need to reference this destination. |

### GetDestination

- 方法：`GET /v1/destination/{destination_code}/get`

- 用途：Get a single destination

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/event-notifications/event-notifications-service-get-destination>

- 使用方法：

```bash
curl -X GET 'https://<base-url>/v1/destination/{destination_code}/get' \
  -H 'Authorization: Bearer <token>'
```

**路径/查询/Header 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `destination_code` | string | 是 | path。A unique code that identifies this destination. Use this code for any API calls that need to reference this destination. |

**请求 Body 参数**

_无明确参数。_

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `destination` | object | 是 | The requested destination. |
| `destination.destination_code` | string | 是 | A unique code that identifies this destination. Use this code for any API calls that need to reference this destination. |
| `destination.destination_name` | string | 是 | A name to identify this destination. For your reference only, no functional impact. |
| `destination.is_active` | boolean | 是 | Whether this destination is active. Inactive destinations will not receive event notifications. |
| `destination.url` | string | 是 | The URL of your server where you want to receive event notifications. |
| `destination.credentials` | object | 是 | Credential keys configured for this destination. Values are redacted. |
| `destination.credentials.values` | object | 是 | A map of HTTP header name to header value. Each entry is sent as a header on every webhook request. Provide one entry per header you want included; the property name is the header name and the value is the header value. Example payload: "values": { "Authorization": "Bearer xxx", "x-api-key": "secret-123" } On read responses, values are redacted (e.g. "******"). |
| `destination.event_types` | array<string> | 是 | Event types this destination subscribes to. Example: ["FBPI::ORDER_SYNC", "FBPO::PO_SYNC"] |

### ListDestinations

- 方法：`GET /v1/destination/list`

- 用途：Gets all destinations for a given project

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/event-notifications/event-notifications-service-list-destinations>

- 使用方法：

```bash
curl -X GET 'https://<base-url>/v1/destination/list' \
  -H 'Authorization: Bearer <token>'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

_无明确参数。_

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `destinations` | array<object> | 是 | All destinations configured for this partner. Maximum of 5 destinations. |
| `destinations[].destination_code` | string | 是 | A unique code that identifies this destination. Use this code for any API calls that need to reference this destination. |
| `destinations[].destination_name` | string | 是 | A name to identify this destination. For your reference only, no functional impact. |
| `destinations[].is_active` | boolean | 是 | Whether this destination is active. Inactive destinations will not receive event notifications. |
| `destinations[].url` | string | 是 | The URL of your server where you want to receive event notifications. |
| `destinations[].credentials` | object | 是 | Credential keys configured for this destination. Values are redacted. |
| `destinations[].credentials.values` | object | 是 | A map of HTTP header name to header value. Each entry is sent as a header on every webhook request. Provide one entry per header you want included; the property name is the header name and the value is the header value. Example payload: "values": { "Authorization": "Bearer xxx", "x-api-key": "secret-123" } On read responses, values are redacted (e.g. "******"). |
| `destinations[].event_types` | array<string> | 是 | Event types this destination subscribes to. Example: ["FBPI::ORDER_SYNC", "FBPO::PO_SYNC"] |

### ListEventTypes

- 方法：`GET /v1/event-type/list`

- 用途：Returns all available event types that can be subscribed to

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/event-notifications/event-notifications-service-list-event-types>

- 使用方法：

```bash
curl -X GET 'https://<base-url>/v1/event-type/list' \
  -H 'Authorization: Bearer <token>'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

_无明确参数。_

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `event_types` | array<string> | 是 | All available event types that can be subscribed to. return format is a list of strings in the format "NAMESPACE::EVENT_NAME", e.g. "FBPI::ORDER_SYNC". Event types payload format and details are also available in our event notification documentation. |

### UpdateDestination

- 方法：`POST /v1/destination/https-destination/{destination_code}/update`

- 用途：Updates an existing destination

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/event-notifications/event-notifications-service-update-destination>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/destination/https-destination/{destination_code}/update' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `destination_code` | string | 是 | path。A unique code that identifies this destination. Use this code for any API calls that need to reference this destination. |

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `destination_name` | string | 否 | A name to identify this destination. For your reference only, no functional impact. |
| `is_active` | boolean | 否 | Whether this destination is active. Inactive destinations will not receive event notifications. |
| `url` | string | 否 | The URL of your server where you want to receive event notifications. |
| `credentials` | object | 否 | Key-value pairs that will be sent as HTTP headers on each webhook request to your server. Use these to authenticate or identify incoming requests on your end. Behavior: - Omitted: existing credentials are left unchanged. - Present with values: replaces all existing credentials. - Present with an empty map: removes all existing credentials. |
| `credentials.values` | object | 是 | A map of HTTP header name to header value. Each entry is sent as a header on every webhook request. Provide one entry per header you want included; the property name is the header name and the value is the header value. Example payload: "values": { "Authorization": "Bearer xxx", "x-api-key": "secret-123" } On read responses, values are redacted (e.g. "******"). |
| `credentials.values` | object | 否 | A map of HTTP header name to header value. Each entry is sent as a header on every webhook request. Provide one entry per header you want included; the property name is the header name and the value is the header value. Example payload: "values": { "Authorization": "Bearer xxx", "x-api-key": "secret-123" } On read responses, values are redacted (e.g. "******"). |
| `event_types` | array<object> | 是 | Event type subscriptions to modify for this destination. Each entry upserts a single subscription based on its is_active flag: - is_active=true: subscribes the destination to this event type (creates the subscription if it does not exist). - is_active=false: unsubscribes the destination from this event type. Event types not included in the list are left unchanged. To leave all subscriptions as-is, omit the field or pass an empty list. Note: setting the destination-level is_active to false does not remove subscriptions. They are preserved, but no events will be delivered while the destination is inactive. Example: [ {event_type: "FBPI::ORDER_SYNC", is_active: true}, {event_type: "FBPO::PO_SYNC", is_active: false} ] |
| `event_types[].event_type` | string | 是 | The unique name of the event type, in the format "NAMESPACE::EVENT_NAME", e.g. "FBPI::ORDER_SYNC". |
| `event_types[].is_active` | boolean | 是 | Whether to activate or deactivate this event type for the destination. If true, the event type will be activated. If false, it will be deactivated. |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `(body)` | object | 否 | - |


## RETURNS / Returns

### ListReturnReferences

- 方法：`POST /v1/return-references/list`

- 用途：List return items and their barcode references matching a barcode for the given merchants

- 官方页面：<https://noon-docs.noonpartners.dev/docs/api-reference/returns/return-reference-service-list-return-references>

- 使用方法：

```bash
curl -X POST 'https://<base-url>/v1/return-references/list' \
  -H 'Authorization: Bearer <token>' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**路径/查询/Header 参数**

_无明确参数。_

**请求 Body 参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `barcode` | string | 是 | Barcode to look up return references for. |
| `merchant_codes` | array<string> | 是 | Optional. Merchant codes to scope the results to (user must have access to). If omitted, results are scoped to the default_project_code, (max 200 items). |

**成功返回参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | array<object> | 是 | Return items matching the requested barcode (max 200 items). |
| `items[].mp_code` | string | 是 | Marketplace code the item belongs to. |
| `items[].purchase_item_nr` | string | 是 | Unique identifier of the purchased item being returned. |
| `items[].partner_sku` | string | 是 | Partner's SKU for the item. |
| `items[].merchant_code` | string | 是 | Code of the merchant that owns the item. |
| `items[].references` | array<object> | 是 | Barcode references attached to this item. |
| `items[].references[].barcode` | string | 是 | Barcode value of the reference. |
| `items[].references[].barcode_type` | string | 是 | Type of the barcode (awb_nr/rms_barcode). |
