import { handleRPC } from "./handler";

export interface Env {
	PRIVATE_STORE: KVNamespace;

}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return handleRPC(request, env)
	},
};
