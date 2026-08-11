import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import './i18n';
import './styles/index.css';
import { AuthProvider } from './lib/auth';
import { queryClient } from './lib/queryClient';
import { router } from './router';
import { ToastHost } from './components/ui';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
        <ToastHost />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
