import { Button } from "../components/Button";
import { Card } from "../components/Card";

function Header() {
  return (
    <header>
      <h1>대시보드</h1>
    </header>
  );
}

export function Dashboard() {
  return (
    <main>
      <Header />
      <Card>
        <p>오늘 주문 12건</p>
        <Button>새로고침</Button>
      </Card>
    </main>
  );
}
