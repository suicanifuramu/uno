import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export function RulesContent() {
  return (
    <Accordion className="w-full">
        <AccordionItem value="basics">
          <AccordionTrigger>基本の進行</AccordionTrigger>
          <AccordionContent>
            <ul className="list-disc space-y-2 pl-5 text-sm leading-6">
              <li>各プレイヤーに7枚配られ、山札の1枚がめくられて捨て札になります。</li>
              <li>
                順番に、捨て札の一番上と「同じ色」または「同じ数字/記号」のカードを1枚出します。
              </li>
              <li>出せるカードがない場合は山札から1枚引きます。</li>
              <li>
                引いたカードが出せる場合は、その場で出して構いません(出さないならキープしてターン終了)。
              </li>
              <li>ワイルド系は常に出せて、出す時に色を指定します。</li>
              <li>最初に手札をすべて出した人の勝ちです。</li>
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="cards">
          <AccordionTrigger>カードの種類</AccordionTrigger>
          <AccordionContent>
            <ul className="list-disc space-y-2 pl-5 text-sm leading-6">
              <li>
                <b>数字 0-9</b>: 効果なし。色と数字が一致する時に出せる。
              </li>
              <li>
                <b>スキップ</b>: 次のプレイヤーの番を飛ばす。
              </li>
              <li>
                <b>リバース</b>: 進行方向を反転する(2人ではスキップとして機能)。
              </li>
              <li>
                <b>+2</b>: 次のプレイヤーが2枚引き、番が飛ぶ。
              </li>
              <li>
                <b>ワイルド</b>: 常に出せて、好きな色を指定する。
              </li>
              <li>
                <b>ワイルド+4</b>: 色を指定し、次のプレイヤーが4枚引きで番も飛ぶ。
              </li>
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="uno">
          <AccordionTrigger>UNO宣言</AccordionTrigger>
          <AccordionContent>
            <ul className="list-disc space-y-2 pl-5 text-sm leading-6">
              <li>手札が2枚になったら「UNO!」ボタンを押して宣言してください。</li>
              <li>
                宣言せずに2枚目を出すと、ペナルティとして2枚引かされます。
              </li>
              <li>宣言できるのは手札がちょうど2枚の間だけです。</li>
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="house">
          <AccordionTrigger>ハウスルール</AccordionTrigger>
          <AccordionContent>
            <ul className="list-disc space-y-2 pl-5 text-sm leading-6">
              <li>
                <b>スタッキング</b>:
                +2や+4を受けるとき、同じ記号を持っていれば罰を重ねて次のプレイヤーへ回せます(+4を+2の上には積めません)。持っていなければ累積した枚数を全部引きます。
              </li>
              <li>
                <b>フォースプレイ</b>: 引いたカードが出せる場合、必ずそのカードを出します。
              </li>
              <li>
                <b>ドロー・トゥ・プレイ</b>: 出せるカードを引くまで山札を引き続けます。
              </li>
              <li>
                <b>ジャンプイン</b>:
                捨て札の一番上と完全に一致するカード(色も数字/記号も)を持っていれば、自分の番でなくても即座に出せます。
              </li>
              <li>
                <b>7-0</b>: 7を出したら好きな相手と手札を交換。0が出たら全員が進行方向の次の人へ手札を回します。
              </li>
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
  );
}
