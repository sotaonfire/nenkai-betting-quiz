import { createApp } from 'vue'
import './style.css'
// 各画面の scoped CSS より必ず先に読み込ませる（view側で import すると本番ビルドで順序が逆転する）
import './theme-macau.css'
import App from './App.vue'
import { router } from './router.js'

createApp(App).use(router).mount('#app')
