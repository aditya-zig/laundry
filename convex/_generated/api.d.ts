/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as engine from "../engine.js";
import type * as http from "../http.js";
import type * as lib_catalogSeed from "../lib/catalogSeed.js";
import type * as lib_conversation from "../lib/conversation.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_hash from "../lib/hash.js";
import type * as lib_ids from "../lib/ids.js";
import type * as lib_validate from "../lib/validate.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  engine: typeof engine;
  http: typeof http;
  "lib/catalogSeed": typeof lib_catalogSeed;
  "lib/conversation": typeof lib_conversation;
  "lib/errors": typeof lib_errors;
  "lib/hash": typeof lib_hash;
  "lib/ids": typeof lib_ids;
  "lib/validate": typeof lib_validate;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
