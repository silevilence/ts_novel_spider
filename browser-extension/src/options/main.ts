import '../shared/styles.css';

const form = document.querySelector<HTMLFormElement>('#bridge-settings');
const status = document.querySelector<HTMLOutputElement>('#save-status');

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (status) {
    status.textContent = '工程骨架已就绪，配对功能将在后续任务中实现。';
  }
});
