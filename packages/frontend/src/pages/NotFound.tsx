import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center animate-sentinel-in">
        <h1 className="mb-2 metric-number text-muted-foreground/60">404</h1>
        <p className="mb-6 text-sm text-muted-foreground/60">Página não encontrada</p>
        <a href="/" className="text-sm text-foreground hover:text-accent-readable transition-colors">
          Voltar ao início
        </a>
      </div>
    </div>
  );
};

export default NotFound;
