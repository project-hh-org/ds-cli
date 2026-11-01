import { Button } from "../components/Button";
import { Card } from "../components/Card";

function Header() {
  return (
    <header>
      <h1>설정</h1>
    </header>
  );
}

export function Settings() {
  return (
    <main>
      <Header />
      <Card>
        <label>알림 받기</label>
        <Button $muted>저장</Button>
      </Card>
    </main>
  );
}
