import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';


export default function AppShell() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex transition-colors duration-200">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 ml-[280px]">
        <Header />
        <main className="flex-1 p-8 lg:p-10 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
