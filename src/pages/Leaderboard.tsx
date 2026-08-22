import { useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { fetchLeaderboard } from "@/lib/client";

interface Row {
  name: string;
  wins: number;
}

export default function Leaderboard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchLeaderboard()
      .then((r) => setRows(r.rows))
      .catch(() => setError(true));
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <h1 className="my-6 text-3xl font-extrabold">リーダーボード</h1>
      <p className="text-muted-foreground mb-4 text-sm">
        部屋での勝利数ランキング(全期間)
      </p>
      {error && (
        <p className="text-destructive text-sm">読み込みに失敗しました。</p>
      )}
      {rows && rows.length === 0 && (
        <p className="text-muted-foreground text-sm">
          まだ記録がありません。最初の勝者になろう!
        </p>
      )}
      {rows && rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">順位</TableHead>
              <TableHead>プレイヤー</TableHead>
              <TableHead className="text-right">優勝回数</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.name}>
                <TableCell>
                  {i === 0 ? (
                    <Badge>🥇 1位</Badge>
                  ) : i === 1 ? (
                    <Badge variant="secondary">🥈 2位</Badge>
                  ) : i === 2 ? (
                    <Badge variant="outline">🥉 3位</Badge>
                  ) : (
                    `${i + 1}位`
                  )}
                </TableCell>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-right font-bold tabular-nums">
                  {r.wins}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
