import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import GMDashboard from "./pages/GMDashboard";
import PlayerLobby from "./pages/PlayerLobby";
import PlayerSheet from "./pages/PlayerSheet";

export default function App() {
  return (
    <div className="min-h-screen">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/gm/:campaignId" element={<GMDashboard />} />
        <Route path="/play/:code" element={<PlayerLobby />} />
        <Route path="/hero/:heroId" element={<PlayerSheet />} />
      </Routes>
    </div>
  );
}
