
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { io, Socket } from 'socket.io-client';

export interface Message {
  id: string;
  chatId: string;
  text: string;
  sender: 'me' | 'them';
  senderId?: string; // ID of the specific contact/bot who sent this
  timestamp: number;
  status: 'sent' | 'delivered' | 'read';
  type?: 'text' | 'voice' | 'image' | 'file';
  mediaUrl?: string;
  fileName?: string;
  fileSize?: string;
  duration?: number; // seconds
}

export interface ChatPreview {
  id: string;
  name: string;
  avatar?: string;
  color: string; // Tailwind color class for avatar bg
  lastMessage: string;
  timestamp: number;
  unreadCount: number;
  isOnline: boolean;
  // New Profile Fields
  isBot?: boolean;
  isGroup?: boolean;
  username?: string;
  bio?: string;
  phone?: string;
  // New Features
  muted?: boolean;
  isAdmin?: boolean;
  membersCount?: number;
  sender?: 'me' | 'them';
  memberIds?: string[]; // IDs of contacts in this group
}

export interface Call {
  id: string;
  contactId: string;
  type: 'incoming' | 'outgoing' | 'missed';
  timestamp: number;
  duration?: number; // seconds
}

export interface UserProfile {
    id: string;
    name: string;
    username: string;
    phone: string;
    bio: string;
    avatarColor: string;
    isPremium?: boolean;
    isAdmin?: boolean;
    privacy?: {
        profilePhoto: 'everybody' | 'nobody';
        phoneNumber?: 'everybody' | 'nobody';
        lastSeen?: 'everybody' | 'nobody';
        stories?: 'everybody' | 'nobody';
    };
}

type Listener = (data: any) => void;

export class ChatSocket {
  private socket: Socket | null = null;
  private listeners: Set<Listener> = new Set();
  private url: string;
  private myUserId: string | null = null;
  private myProfile: UserProfile | null = null;

  constructor(url?: string) {
    // Logic to determine WebSocket URL
    if (url) {
        this.url = url;
    } else {
        const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
        const hostname = window.location.hostname || 'localhost';
        
        // If we are on port 5173 (Vite Dev Server), the backend is likely on 3000.
        // If we are on any other port (e.g. 3000 in prod), the backend is on the SAME port.
        const isDev = window.location.port === '5173';
        const port = isDev ? '3000' : (window.location.port || (window.location.protocol === 'https:' ? '443' : '80'));
        
        this.url = `${protocol}//${hostname}:${port}`;
    }
    
    this.connect();
  }

  private connect() {
    if (this.socket && this.socket.connected) {
        return;
    }

    try {
      this.socket = io(this.url, {
          transports: ['websocket', 'polling']
      });
      
      this.socket.on('connect', () => {
        console.log('Connected to RedGram Server at', this.url);
        this.notify({ type: 'STATUS', status: 'CONNECTED' });
        
        // Re-announce presence if we have an ID
        if (this.myProfile) {
            // Re-register to ensure server knows we are here after reconnect
            this.registerUser(this.myProfile);
        } else if (this.myUserId) {
            this.announcePresence();
        }
      });

      this.socket.on('INIT_STATE', (data) => {
          if (data.users) {
              this.notify({ type: 'USER_SYNC', users: data.users });
          }
      });

      this.socket.on('USER_JOINED', (data) => {
          if (data.profile.id !== this.myUserId) {
              this.notify({ type: 'USER_JOINED', profile: data.profile });
          }
      });

      this.socket.on('NEW_MESSAGE', (data) => {
          const msg = data.message;
          this.notify({ type: 'NEW_MESSAGE', message: msg });
      });

      this.socket.on('MESSAGE_READ', (data) => {
          this.notify({ 
              type: 'MESSAGE_READ', 
              chatId: data.chatId, 
              messageIds: data.messageIds,
              readerId: data.readerId
          });
      });

      this.socket.on('connect_error', (e) => {
        console.warn('Socket.IO connection error. Ensure "node server.js" is running.', e);
      });

      this.socket.on('disconnect', () => {
        console.log('Disconnected from server.');
      });
    } catch (e) {
      console.error("Socket init error", e);
    }
  }

  public setUserId(id: string) {
      this.myUserId = id;
  }

  public disconnect() {
      if (this.socket) {
          this.socket.disconnect();
          this.socket = null;
      }
  }

  public registerUser(profile: UserProfile) {
      this.myUserId = profile.id;
      this.myProfile = profile;
      if (this.socket && this.socket.connected) {
          this.socket.emit('REGISTER', { profile: profile });
      }
  }
  
  public announcePresence() {
      if (this.socket && this.socket.connected && this.myUserId) {
          this.socket.emit('PRESENCE', { userId: this.myUserId });
      }
  }

  public subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(data: any) {
    this.listeners.forEach(l => l(data));
  }

  public sendMessage(chatId: string, text: string, toUserId?: string, isGroup?: boolean, attachment?: { type: 'voice' | 'image' | 'file', mediaUrl: string, fileName?: string, fileSize?: string, duration?: number }) {
    const msg: Message = {
      id: Date.now().toString(),
      chatId,
      text,
      sender: 'me',
      senderId: this.myUserId || 'me',
      timestamp: Date.now(),
      status: 'sent',
      ...attachment
    };

    // Send to Server
    if (this.socket && this.socket.connected) {
      this.socket.emit('SEND_MESSAGE', { 
          message: {
             ...msg,
             chatId: isGroup ? chatId : toUserId, // If DM, send to their UserID. If Group, send to ChatID.
             senderId: this.myUserId
          },
          isGroup
      });
    } 
  }

  public redeemPromo(userId: string, code: string) {
      if (this.socket && this.socket.connected) {
          this.socket.emit('REDEEM_PROMO', { userId, code });
      }
  }

  public getAdminData(userId: string) {
      if (this.socket && this.socket.connected) {
          this.socket.emit('ADMIN_GET_ALL_DATA', { userId });
      }
  }

  public sendReadReceipt(chatId: string, messageIds: string[]) {
      if (this.socket && this.socket.connected) {
          this.socket.emit('MESSAGE_READ', { 
              chatId, 
              messageIds, 
              readerId: this.myUserId 
          });
      }
  }
}
