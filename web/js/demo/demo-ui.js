// Franja del modo demostración: cambiar de rol y reiniciar los datos de ejemplo.
(() => {
  const ids = window.__DEMO_IDS__;
  const current = sessionStorage.getItem('mockuser') === ids.student ? 'student' : 'teacher';
  document.querySelectorAll('.demo-banner [data-role]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.role === current));
    b.addEventListener('click', () => {
      sessionStorage.setItem('mockuser', ids[b.dataset.role]);
      location.hash = '#/';
      location.reload();
    });
  });
  document.querySelector('.demo-banner [data-reset]')?.addEventListener('click', () => {
    localStorage.removeItem('aula.demo.db.v1');
    location.hash = '#/';
    location.reload();
  });
})();
