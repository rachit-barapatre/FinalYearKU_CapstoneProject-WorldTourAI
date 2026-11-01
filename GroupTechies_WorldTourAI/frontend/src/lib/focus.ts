/** Scroll the landing page's trip box into view and put the cursor in it (used by every "Start planning" button). */
export function focusTripInput(): void {
  const input = document.getElementById('trip-input') as HTMLTextAreaElement | null
  if (!input) return
  input.scrollIntoView({ behavior: 'smooth', block: 'center' })
  input.focus({ preventScroll: true })
  const end = input.value.length
  input.setSelectionRange(end, end)
}
