// Package push sends Web Push notifications to subscribed devices.
//
// Subscriptions are stored in Redis as JSON blobs at user:{username}:push.
// On send, dead subscriptions (404/410 from the push service) are pruned.
package push

import (
	"context"
	"encoding/json"
	"log"
	"sync"

	webpush "github.com/SherClockHolmes/webpush-go"

	rdb "chatinpeace/internal/redis"
)

type Sender struct {
	redis   *rdb.Client
	options *webpush.Options
	enabled bool
}

// New returns a Sender. If publicKey or privateKey is empty, the Sender is a
// no-op (web push is opt-in via env vars).
func New(redis *rdb.Client, publicKey, privateKey, subject string) *Sender {
	if publicKey == "" || privateKey == "" {
		return &Sender{redis: redis, enabled: false}
	}
	return &Sender{
		redis:   redis,
		enabled: true,
		options: &webpush.Options{
			Subscriber:      subject,
			VAPIDPublicKey:  publicKey,
			VAPIDPrivateKey: privateKey,
			TTL:             60,
		},
	}
}

func (s *Sender) Enabled() bool { return s != nil && s.enabled }

// Payload is the JSON body delivered to the service worker's push event.
type Payload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	Tag   string `json:"tag,omitempty"` // used to coalesce notifications per conversation
	URL   string `json:"url,omitempty"` // where to focus/open on click
}

// Send fan-outs the payload to every device subscribed for `username`. Dead
// subscriptions are removed from Redis. Safe to call when disabled.
func (s *Sender) Send(ctx context.Context, username string, payload Payload) {
	if !s.Enabled() {
		return
	}
	subs, err := s.redis.GetPushSubs(ctx, username)
	if err != nil || len(subs) == 0 {
		return
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return
	}

	var wg sync.WaitGroup
	for _, raw := range subs {
		var sub webpush.Subscription
		if err := json.Unmarshal([]byte(raw), &sub); err != nil {
			// Malformed entry — drop it.
			_ = s.redis.RemovePushSub(ctx, username, raw)
			continue
		}
		wg.Add(1)
		go func(raw string, sub webpush.Subscription) {
			defer wg.Done()
			resp, err := webpush.SendNotificationWithContext(ctx, body, &sub, s.options)
			if err != nil {
				log.Printf("push: send to %s failed: %v", username, err)
				return
			}
			defer resp.Body.Close()
			if resp.StatusCode == 404 || resp.StatusCode == 410 {
				// Subscription is gone — clean it up.
				_ = s.redis.RemovePushSub(ctx, username, raw)
			}
		}(raw, sub)
	}
	wg.Wait()
}
