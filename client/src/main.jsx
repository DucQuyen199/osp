import { createRoot } from 'react-dom/client';
import App, { OfflineNotice } from './app/App.jsx';
import FeedbackHost from './components/FeedbackHost.jsx';
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {});
}

createRoot(document.getElementById('app')).render(<><OfflineNotice /><FeedbackHost /><App /></>);
