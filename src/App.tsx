/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Search, RefreshCw, Trash2, ExternalLink, Play, MessageSquare, Clock, UserPlus, ArrowUpDown, Download, Upload, FileText, X } from 'lucide-react';

// Types
interface UP {
  uid: string;
  name: string;
  face: string;
  sign: string;
  added_at: number;
}

interface Video {
  bvid: string;
  uid: string;
  title: string;
  pic: string;
  created: number;
  length: string;
  play: number;
  comment: number;
  description: string;
  fetched_at: number;
  up_name: string;
  up_face: string;
}

export default function App() {
  const [ups, setUps] = useState<UP[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchName, setSearchName] = useState('');
  const [activeTab, setActiveTab] = useState<'videos' | 'ups'>('videos');
  const [autoRefresh, setAutoRefresh] = useState(false);
  
  // New states for batch/backup
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchInput, setBatchInput] = useState('');
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchResult, setBatchResult] = useState<{success: any[], failed: any[]} | null>(null);
  
  // Delete confirmation state
  const [upToDelete, setUpToDelete] = useState<UP | null>(null);
  
  // Sorting states
  const [upSort, setUpSort] = useState<{ field: keyof UP, order: 'asc' | 'desc' }>({ field: 'added_at', order: 'desc' });
  const [videoSort, setVideoSort] = useState<{ field: keyof Video, order: 'asc' | 'desc' }>({ field: 'created', order: 'desc' });

  const fetchUps = async () => {
    const res = await fetch('/api/ups');
    const data = await res.json();
    setUps(data);
  };

  const fetchVideos = async () => {
    const res = await fetch('/api/videos');
    const data = await res.json();
    setVideos(data);
  };

  const handleAddUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchName.trim()) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/ups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: searchName.trim() })
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        setSearchName('');
        await fetchUps();
        handleRefresh(); // Fetch videos for the new UP
      }
    } catch (err) {
      alert('Failed to add UP');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveUp = async (uid: string) => {
    try {
      const res = await fetch(`/api/ups/${uid}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      await fetchUps();
      await fetchVideos();
      setUpToDelete(null);
    } catch (err) {
      alert('Failed to remove UP');
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        console.error(data.error);
      } else {
        await fetchVideos();
      }
    } catch (err) {
      console.error('Failed to refresh');
    } finally {
      setRefreshing(false);
    }
  };

  const handleBackup = async () => {
    try {
      const res = await fetch('/api/backup');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bilibili_ups_backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('备份失败');
    }
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        const ups = JSON.parse(content);
        const res = await fetch('/api/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ups })
        });
        const data = await res.json();
        if (data.success) {
          alert(`成功恢复 ${data.count} 个 UP 主`);
          fetchUps();
          handleRefresh();
        } else {
          alert(data.error || '恢复失败');
        }
      } catch (err) {
        alert('解析备份文件失败');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleBatchImport = async () => {
    const names = batchInput.split('\n').map(n => n.trim()).filter(n => n);
    if (names.length === 0) return;
    
    setBatchLoading(true);
    setBatchResult(null);
    try {
      const res = await fetch('/api/ups/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names })
      });
      
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(`Server returned non-JSON: ${text.substring(0, 100)}`);
      }

      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setBatchResult(data);
      fetchUps();
      if (data.success && data.success.length > 0) {
        handleRefresh();
      }
    } catch (err: any) {
      alert(`批量导入失败: ${err.message}`);
    } finally {
      setBatchLoading(false);
    }
  };

  useEffect(() => {
    fetchUps();
    fetchVideos();
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (autoRefresh) {
      interval = setInterval(() => {
        handleRefresh();
      }, 5 * 60 * 1000); // 5 minutes
    }
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const sortedUps = [...ups].sort((a, b) => {
    const valA = a[upSort.field];
    const valB = b[upSort.field];
    if (valA < valB) return upSort.order === 'asc' ? -1 : 1;
    if (valA > valB) return upSort.order === 'asc' ? 1 : -1;
    return 0;
  });

  const sortedVideos = [...videos].sort((a, b) => {
    let valA: any = a[videoSort.field];
    let valB: any = b[videoSort.field];
    
    // Handle length sorting (MM:SS)
    if (videoSort.field === 'length') {
      const parseLength = (len: string) => {
        const parts = len.split(':').map(Number);
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        return 0;
      };
      valA = parseLength(valA);
      valB = parseLength(valB);
    }

    if (valA < valB) return videoSort.order === 'asc' ? -1 : 1;
    if (valA > valB) return videoSort.order === 'asc' ? 1 : -1;
    return 0;
  });

  const toggleUpSort = (field: keyof UP) => {
    setUpSort(prev => ({
      field,
      order: prev.field === field && prev.order === 'desc' ? 'asc' : 'desc'
    }));
  };

  const toggleVideoSort = (field: keyof Video) => {
    setVideoSort(prev => ({
      field,
      order: prev.field === field && prev.order === 'desc' ? 'asc' : 'desc'
    }));
  };

  const formatTime = (ts: number) => {
    return new Date(ts * 1000).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  };

  const formatNumber = (num: number) => {
    return num >= 10000 ? (num / 10000).toFixed(1) + '万' : num.toString();
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-blue-500">
            <Play className="w-6 h-6 fill-current" />
            <h1 className="text-xl font-bold text-zinc-800">B站UP主监控系统</h1>
          </div>
          
          <div className="flex items-center gap-6">
            <form onSubmit={handleAddUp} className="flex items-center relative">
              <input
                type="text"
                placeholder="输入UP主名字..."
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                className="pl-10 pr-4 py-2 bg-zinc-100 border-transparent rounded-full text-sm focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all w-64"
                disabled={loading}
              />
              <Search className="w-4 h-4 text-zinc-400 absolute left-4" />
              <button 
                type="submit" 
                disabled={loading || !searchName.trim()}
                className="absolute right-1 p-1.5 bg-blue-500 text-white rounded-full hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                <UserPlus className="w-4 h-4" />
              </button>
            </form>

            <div className="flex items-center gap-2 border-l border-zinc-200 pl-6">
              <label className="flex items-center gap-2 text-sm text-zinc-600 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded text-blue-500 focus:ring-blue-500"
                />
                自动刷新 (5分钟)
              </label>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? '刷新中...' : '手动刷新'}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-zinc-200">
          <button
            onClick={() => setActiveTab('videos')}
            className={`pb-3 px-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'videos' ? 'border-blue-500 text-blue-600' : 'border-transparent text-zinc-500 hover:text-zinc-800'
            }`}
          >
            最新视频 ({videos.length})
          </button>
          <button
            onClick={() => setActiveTab('ups')}
            className={`pb-3 px-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'ups' ? 'border-blue-500 text-blue-600' : 'border-transparent text-zinc-500 hover:text-zinc-800'
            }`}
          >
            监控列表 ({ups.length})
          </button>
        </div>

        {/* Videos Tab */}
        {activeTab === 'videos' && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 mb-4 text-sm text-zinc-500">
              <span className="font-medium text-zinc-700">排序方式:</span>
              <button onClick={() => toggleVideoSort('created')} className={`flex items-center gap-1 hover:text-zinc-800 ${videoSort.field === 'created' ? 'text-blue-600 font-medium' : ''}`}>
                发布时间 <ArrowUpDown className="w-3 h-3" />
              </button>
              <button onClick={() => toggleVideoSort('play')} className={`flex items-center gap-1 hover:text-zinc-800 ${videoSort.field === 'play' ? 'text-blue-600 font-medium' : ''}`}>
                播放量 <ArrowUpDown className="w-3 h-3" />
              </button>
              <button onClick={() => toggleVideoSort('length')} className={`flex items-center gap-1 hover:text-zinc-800 ${videoSort.field === 'length' ? 'text-blue-600 font-medium' : ''}`}>
                时长 <ArrowUpDown className="w-3 h-3" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {sortedVideos.map(video => (
                <a 
                  key={video.bvid} 
                  href={`https://www.bilibili.com/video/${video.bvid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all border border-zinc-100 flex flex-col"
                >
                  <div className="relative aspect-video overflow-hidden bg-zinc-100">
                    <img 
                      src={video.pic} 
                      alt={video.title} 
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/70 text-white text-xs rounded font-mono">
                      {video.length}
                    </div>
                  </div>
                  <div className="p-4 flex-1 flex flex-col">
                    <h3 className="font-medium text-zinc-900 line-clamp-2 mb-2 group-hover:text-blue-600 transition-colors" title={video.title}>
                      {video.title}
                    </h3>
                    <div className="mt-auto">
                      <div className="flex items-center gap-2 mb-3">
                        <img src={video.up_face} alt={video.up_name} referrerPolicy="no-referrer" className="w-5 h-5 rounded-full" />
                        <span className="text-xs text-zinc-600 hover:text-blue-500">{video.up_name}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-zinc-500">
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1"><Play className="w-3 h-3" /> {formatNumber(video.play)}</span>
                          <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {formatNumber(video.comment)}</span>
                        </div>
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {formatTime(video.created)}</span>
                      </div>
                    </div>
                  </div>
                </a>
              ))}
              {sortedVideos.length === 0 && (
                <div className="col-span-full py-20 text-center text-zinc-500">
                  暂无视频，请先添加UP主并刷新
                </div>
              )}
            </div>
          </div>
        )}

        {/* UPs Tab */}
        {activeTab === 'ups' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4 text-sm text-zinc-500">
                <span className="font-medium text-zinc-700">排序方式:</span>
                <button onClick={() => toggleUpSort('added_at')} className={`flex items-center gap-1 hover:text-zinc-800 ${upSort.field === 'added_at' ? 'text-blue-600 font-medium' : ''}`}>
                  添加时间 <ArrowUpDown className="w-3 h-3" />
                </button>
                <button onClick={() => toggleUpSort('name')} className={`flex items-center gap-1 hover:text-zinc-800 ${upSort.field === 'name' ? 'text-blue-600 font-medium' : ''}`}>
                  名字 <ArrowUpDown className="w-3 h-3" />
                </button>
                <button onClick={() => toggleUpSort('uid')} className={`flex items-center gap-1 hover:text-zinc-800 ${upSort.field === 'uid' ? 'text-blue-600 font-medium' : ''}`}>
                  UID <ArrowUpDown className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setShowBatchModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg text-sm font-medium transition-colors"
                >
                  <FileText className="w-4 h-4" /> 批量导入
                </button>
                <button 
                  onClick={handleBackup}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg text-sm font-medium transition-colors"
                >
                  <Download className="w-4 h-4" /> 备份
                </button>
                <label className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg text-sm font-medium transition-colors cursor-pointer">
                  <Upload className="w-4 h-4" /> 恢复
                  <input type="file" accept=".json" className="hidden" onChange={handleRestore} />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedUps.map(up => (
                <div key={up.uid} className="bg-white p-4 rounded-xl shadow-sm border border-zinc-100 flex items-start gap-4">
                  <a href={`https://space.bilibili.com/${up.uid}`} target="_blank" rel="noopener noreferrer" className="shrink-0">
                    <img src={up.face} alt={up.name} referrerPolicy="no-referrer" className="w-12 h-12 rounded-full border border-zinc-200" />
                  </a>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <a href={`https://space.bilibili.com/${up.uid}`} target="_blank" rel="noopener noreferrer" className="font-medium text-zinc-900 hover:text-blue-600 truncate flex items-center gap-1">
                        {up.name}
                        <ExternalLink className="w-3 h-3 text-zinc-400" />
                      </a>
                      <button 
                        onClick={() => setUpToDelete(up)}
                        className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                        title="取消监控"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-xs text-zinc-500 mb-2">UID: {up.uid}</p>
                    <p className="text-xs text-zinc-600 line-clamp-2" title={up.sign}>{up.sign || '这个人很懒，什么都没写'}</p>
                  </div>
                </div>
              ))}
              {sortedUps.length === 0 && (
                <div className="col-span-full py-20 text-center text-zinc-500">
                  监控列表为空，请在右上角添加UP主
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Batch Import Modal */}
      {showBatchModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-4 border-b border-zinc-100">
              <h2 className="text-lg font-bold text-zinc-800">批量导入 UP 主</h2>
              <button onClick={() => setShowBatchModal(false)} className="p-1 text-zinc-400 hover:text-zinc-600 rounded-lg hover:bg-zinc-100 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {!batchResult ? (
                <>
                  <p className="text-sm text-zinc-500 mb-2">请输入 UP 主名字，每行一个：</p>
                  <textarea
                    value={batchInput}
                    onChange={(e) => setBatchInput(e.target.value)}
                    className="w-full h-48 p-3 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    placeholder="罗翔说刑法&#10;老番茄&#10;影视飓风"
                    disabled={batchLoading}
                  />
                </>
              ) : (
                <div className="space-y-4">
                  {batchResult.success && (
                    <div className="p-3 bg-green-50 text-green-700 rounded-lg text-sm">
                      成功导入 {batchResult.success.length} 个 UP 主
                    </div>
                  )}
                  {batchResult.failed && batchResult.failed.length > 0 && (
                    <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                      失败 {batchResult.failed.length} 个：
                      <ul className="mt-2 space-y-1 list-disc list-inside">
                        {batchResult.failed.map((f: any, i: number) => (
                          <li key={i}>{f.name} - {f.reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex justify-end gap-2">
              <button 
                onClick={() => {
                  setShowBatchModal(false);
                  setBatchResult(null);
                  setBatchInput('');
                }}
                className="px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-800 hover:bg-zinc-200 rounded-lg transition-colors"
              >
                {batchResult ? '关闭' : '取消'}
              </button>
              {!batchResult && (
                <button 
                  onClick={handleBatchImport}
                  disabled={batchLoading || !batchInput.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {batchLoading && <RefreshCw className="w-4 h-4 animate-spin" />}
                  {batchLoading ? '导入中...' : '开始导入'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {upToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden flex flex-col">
            <div className="p-6">
              <h2 className="text-lg font-bold text-zinc-800 mb-2">取消监控</h2>
              <p className="text-sm text-zinc-600">
                确定要取消监控 UP主 <span className="font-semibold text-zinc-900">{upToDelete.name}</span> 吗？
                <br />
                这将会同时删除该 UP主 的所有已缓存视频记录。
              </p>
            </div>
            <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex justify-end gap-2">
              <button 
                onClick={() => setUpToDelete(null)}
                className="px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-800 hover:bg-zinc-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button 
                onClick={() => handleRemoveUp(upToDelete.uid)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> 确定删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
