import { handlePermitPulseRequest } from './api.mjs';
import { runAutomationCycle } from './pipeline/engine.mjs';

export default {
  async fetch(request, env, ctx) {
    const apiResponse = await handlePermitPulseRequest(request, env, ctx);
    if (apiResponse) {
      return apiResponse;
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    const task = runAutomationCycle(env, {
      triggerType: 'schedule',
      triggeredBy: null,
    }).catch((error) => {
      console.error('Scheduled automation failed', error);
    });

    if (ctx?.waitUntil) {
      ctx.waitUntil(task);
      return;
    }

    await task;
  },
};
