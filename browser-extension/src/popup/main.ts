import '../shared/styles.css';

const openOptionsButton = document.querySelector<HTMLButtonElement>('#open-options');

openOptionsButton?.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});
