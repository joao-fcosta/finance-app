'use client';

import { supabase } from '@/app/lib/supabase';

export default function Login() {
  const entrarComGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      alert('Erro ao entrar com Google.');
      console.error(error);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-900 p-8 text-center">
      <div className="max-w-sm w-full">
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-2">
          Finance
        </h1>

        <p className="text-lg text-slate-500 dark:text-slate-400 mb-12">
          Organize suas contas sem <br />
          complicação e em segundos.
        </p>

        <button
          onClick={entrarComGoogle}
          className="w-full flex items-center justify-center gap-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 h-14 rounded-2xl font-semibold transition-transform active:scale-95"
        >
          <img
            src="https://www.gstatic.com/images/branding/product/1x/gsa_512dp.png"
            width="20"
            alt="Google"
          />

          Entrar com Google
        </button>
      </div>

      <footer className="absolute bottom-8 text-xs text-slate-400 text-center w-full px-4">
        Seus dados são armazenados de forma segura na nuvem.
      </footer>
    </div>
  );
}