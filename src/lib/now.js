import { onUnmounted, ref } from 'vue'

/**
 * 一定間隔で更新される現在時刻。
 * computed の中で Date.now() を直接使うと、他のデータが変わるまで再計算されず
 * 「切断」などの時間経過による表示が固まるため、これを参照する。
 */
export function useNow(intervalMs = 5000) {
  const now = ref(Date.now())
  const timer = setInterval(() => (now.value = Date.now()), intervalMs)
  onUnmounted(() => clearInterval(timer))
  return now
}
