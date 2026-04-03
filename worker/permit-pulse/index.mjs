import { handlePermitPulseRequest } from './api.mjs';
import { runScheduledWork } from './pipeline/scheduler.mjs';

export default {
  async fetch(request, env, ctx) {
    const apiResponse = await handlePermitPulseRequest(request, env, ctx);
    if (apiResponse) {
      return apiResponse;
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    const task = runScheduledWork(env).catch((error) => {
      console.error('Scheduled automation failed', error);
    });

    if (ctx?.waitUntil) {
      ctx.waitUntil(task);
      return;
    }

    await task;
  },
};
