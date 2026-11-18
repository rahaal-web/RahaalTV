import { Component, ErrorInfo, ReactNode } from 'react';
import { reportClientError } from '../lib/clientLogger';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'حدث خطأ غير متوقع أثناء تحميل التطبيق.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('RahaL TV ErrorBoundary caught an error:', error, info);
    reportClientError({
      source: 'react.ErrorBoundary',
      level: 'fatal',
      message: error?.message || 'React ErrorBoundary crash',
      error,
      context: {
        componentStack: (info?.componentStack || '').slice(0, 240),
      },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="min-h-screen bg-[#06131c] text-white flex flex-col items-center justify-center px-6 text-center"
        >
          <div className="max-w-md w-full rounded-3xl bg-[#0c1821] border border-white/10 p-8 shadow-2xl">
            <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-[#D92321]/20 border border-[#D92321]/40 flex items-center justify-center text-[#D92321] font-black text-2xl">
              !
            </div>
            <h1 className="text-xl font-black mb-2">تعذر عرض الصفحة مؤقتاً</h1>
            <p className="text-sm text-[#b7c9ef] mb-6 leading-relaxed">
              حدث عطل تقني أثناء تحميل واجهة RahaL TV. يمكنك إعادة تحميل الصفحة للمتابعة.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full rounded-xl bg-[#D92321] hover:bg-[#dc0e30] px-5 py-3 text-sm font-extrabold text-white transition-colors cursor-pointer"
            >
              إعادة تحميل الموقع
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
