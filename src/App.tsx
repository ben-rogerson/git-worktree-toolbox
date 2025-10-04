import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Index } from "./app/page";
import { TestPage } from "./app/test/page";

export function App() {
  return (
    <BrowserRouter>
      <div className="bg-[black] min-h-screen p-20 grid w-full">
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/test" element={<TestPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
