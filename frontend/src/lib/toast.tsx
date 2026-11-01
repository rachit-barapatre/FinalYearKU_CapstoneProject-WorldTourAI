import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react'
import { Slide, ToastContainer, type ToastContentProps, type TypeOptions } from 'react-toastify'
import { useDarkTheme } from './theme'

export { toast } from 'react-toastify'

const ICONS: Record<TypeOptions, React.ReactNode> = {
  success: <CheckCircle2 size={18} strokeWidth={2.4} />,
  error: <XCircle size={18} strokeWidth={2.4} />,
  warning: <AlertTriangle size={18} strokeWidth={2.4} />,
  info: <Info size={18} strokeWidth={2.4} />,
  default: <Info size={18} strokeWidth={2.4} />,
}

function CloseButton({ closeToast }: Pick<ToastContentProps, 'closeToast'>) {
  return (
    <button onClick={() => closeToast()} aria-label="Dismiss" className="wt-toast-close">
      <X size={15} />
    </button>
  )
}

/** Pop-up notifications (react-toastify) in WorldTour's look; colours and layout live in index.css. */
export function Toaster() {
  const dark = useDarkTheme()
  return (
    <ToastContainer
      position="bottom-right"
      autoClose={3500}
      newestOnTop
      closeOnClick
      pauseOnFocusLoss={false}
      transition={Slide}
      theme={dark ? 'dark' : 'light'}
      limit={3}
      toastClassName="wt-toast"
      icon={({ type, isLoading }) => <span className={`wt-toast-icon wt-toast-icon--${type}`}>{isLoading ? <Loader2 size={18} className="animate-spin" /> : ICONS[type]}</span>}
      closeButton={CloseButton}
    />
  )
}
