import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'join', component: () => import('./views/JoinView.vue') },
    { path: '/play', name: 'play', component: () => import('./views/PlayView.vue') },
    { path: '/screen', name: 'screen', component: () => import('./views/ScreenView.vue') },
    { path: '/admin', name: 'admin', component: () => import('./views/AdminView.vue') },
    { path: '/qr', name: 'qr', component: () => import('./views/QrView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
