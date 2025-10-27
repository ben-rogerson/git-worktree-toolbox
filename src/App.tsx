import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Index } from "./app/page";

export function App() {
  return (
    <BrowserRouter>
      <div className="bg-[black] min-h-screen p-20 grid w-full">
        <Routes>
          <Route path="/" element={<Index />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
