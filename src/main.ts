// Entry point. The full bootstrap lands in Phase 1; this keeps the build green meanwhile.
const app = document.getElementById('app');
if (app) app.dataset.state = 'boot';
