// main/src/lib/supabase.ts
// Core Supabase Authentication and Database Client Engine
// ──────────────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

// Connects directly to the environment keys we placed in the root .env file
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("[supabase-init] Missing cryptographic credentials. Environment configuration unaligned.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Dispatches device activation codes directly to your Supabase Edge Function
 * @param activationCode The raw text code punched in by the operator
 */
export async function verifyDeviceActivation(activationCode: string): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('server', {
      body: { action: 'activate', code: activationCode, timestamp: new Date().toISOString() }
    });

    if (error) throw error;
    if (data && data.success) {
      // Cache the authenticated token state locally to survive offshore power cycles
      localStorage.setItem('tac_offshore_token', data.token);
      return { success: true, token: data.token };
    }
    
    return { success: false, error: data?.message || 'Invalid activation credentials' };
  } catch (err: any) {
    console.error('[supabase-activation-handshake] Critical failure:', err);
    return { success: false, error: err.message || 'Server connection timeout' };
  }
}
