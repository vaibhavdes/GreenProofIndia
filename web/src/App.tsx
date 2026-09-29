import { Route, Routes } from "react-router-dom";
import ProjectPage from "./pages/ProjectPage";
import Projects from "./pages/Projects";
import Report from "./pages/Report";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Projects />} />
      <Route path="/p/:pid" element={<ProjectPage />} />
      <Route path="/r/:token" element={<Report />} />
      <Route path="*" element={<Projects />} />
    </Routes>
  );
}
