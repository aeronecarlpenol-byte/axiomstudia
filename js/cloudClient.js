import { cloudConfig } from './cloudConfig.js';

let clients;
export function cloudConfigured() {
  return Boolean(cloudConfig.url && cloudConfig.publishableKey);
}

export async function getCloudClients() {
  if (!cloudConfigured()) throw new Error('Cloud setup is pending. Your work stays in this browser.');
  if (!clients) {
    clients = (async () => {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.57.4');
      const options = { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false };
      return {
        visitor: createClient(cloudConfig.url, cloudConfig.publishableKey, {
          auth: { ...options, storageKey: 'axiom-visitor-auth', storage: localStorage }
        }),
        admin: createClient(cloudConfig.url, cloudConfig.publishableKey, {
          auth: { ...options, storageKey: 'axiom-admin-auth', storage: sessionStorage }
        })
      };
    })().catch(error => { clients = null; throw error; });
  }
  return clients;
}
