export const selectableTableRowProps = {
  tabIndex: 0,
  'data-selectable-row': '',
  onKeyDown(event) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.currentTarget.click();
  },
};
